package dev.rvveber.littletiles.parityexporter;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.arguments.StringArgumentType;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.TagParser;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.Level;
import net.neoforged.fml.ModList;
import team.creative.creativecore.common.util.math.base.Facing;
import team.creative.creativecore.common.util.math.box.BoxCorner;
import team.creative.creativecore.common.util.math.vec.Vec3f;
import team.creative.littletiles.common.block.entity.BETiles;
import team.creative.littletiles.common.block.little.tile.LittleTile;
import team.creative.littletiles.common.block.little.tile.group.LittleGroup;
import team.creative.littletiles.common.block.little.tile.parent.IParentCollection;
import team.creative.littletiles.common.convertion.OldLittleTilesDataParser;
import team.creative.littletiles.common.grid.LittleGrid;
import team.creative.littletiles.common.math.box.LittleBox;
import team.creative.littletiles.common.math.box.LittleTransformableBox;
import team.creative.littletiles.common.math.box.LittleTransformableBox.VectorFanFaceCache;
import team.creative.littletiles.common.math.face.LittleFaceState;
import team.creative.littletiles.common.math.face.LittleServerFace;
import team.creative.littletiles.common.structure.LittleStructure;
import team.creative.littletiles.common.structure.LittleStructureType;
import team.creative.littletiles.common.structure.attribute.LittleStructureAttribute;
import team.creative.littletiles.common.structure.exception.CorruptedConnectionException;
import team.creative.littletiles.common.structure.exception.NotYetConnectedException;
import team.creative.littletiles.common.math.vec.LittleVec;

public final class LtDebugExportCommand {

    private static final Gson GSON = new GsonBuilder()
            .setPrettyPrinting()
            .disableHtmlEscaping()
            .create();
    private static final boolean EXPORT_FACE_STATES = true;

    private enum GeometryMode {
        CLIENT("client"),
        SERVER("server");

        final String id;

        GeometryMode(String id) {
            this.id = id;
        }

        static GeometryMode fromArg(String raw) {
            String value = raw == null ? "" : raw.trim().toLowerCase();
            return switch (value) {
                case "client" -> CLIENT;
                case "server" -> SERVER;
                default -> null;
            };
        }
    }

    private LtDebugExportCommand() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        LiteralArgumentBuilder<CommandSourceStack> root = Commands.literal("lt-debug-export")
                .requires(source -> source.hasPermission(2))
                .then(Commands.argument("input_dir", StringArgumentType.string())
                        .then(Commands.argument("output_dir", StringArgumentType.string())
                                .executes(context -> executeBatch(
                                        context.getSource(),
                                        StringArgumentType.getString(context, "input_dir"),
                                        StringArgumentType.getString(context, "output_dir"),
                                        GeometryMode.CLIENT))
                                .then(Commands.argument("geometry_mode", StringArgumentType.word())
                                        .executes(context -> executeBatchWithGeometryMode(
                                                context.getSource(),
                                                StringArgumentType.getString(context, "input_dir"),
                                                StringArgumentType.getString(context, "output_dir"),
                                                StringArgumentType.getString(context, "geometry_mode"))))));
        dispatcher.register(root);
    }

    private static int executeBatchWithGeometryMode(
            CommandSourceStack source,
            String inputDirArg,
            String outputDirArg,
            String geometryModeArg) {
        GeometryMode geometryMode = GeometryMode.fromArg(geometryModeArg);
        if (geometryMode == null) {
            source.sendFailure(Component.literal(
                    "lt-debug-export failed: invalid geometry_mode \"" + geometryModeArg + "\" (expected: client|server)"));
            return 0;
        }
        return executeBatch(source, inputDirArg, outputDirArg, geometryMode);
    }

    private static int executeBatch(
            CommandSourceStack source,
            String inputDirArg,
            String outputDirArg,
            GeometryMode geometryMode) {
        MinecraftServer server = source.getServer();
        Path inputDir = resolvePath(server, inputDirArg);
        Path outputDir = resolvePath(server, outputDirArg);

        try {
            if (!Files.isDirectory(inputDir)) {
                source.sendFailure(Component.literal("lt-debug-export failed: input path is not a directory: " + inputDir));
                return 0;
            }
            Files.createDirectories(outputDir);

            List<Path> inputFiles;
            try (Stream<Path> stream = Files.list(inputDir)) {
                inputFiles = stream
                        .filter(Files::isRegularFile)
                        .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                        .toList();
            }

            if (inputFiles.isEmpty()) {
                source.sendFailure(Component.literal("lt-debug-export failed: input directory has no files: " + inputDir));
                return 0;
            }

            int ok = 0;
            int failed = 0;
            long totalTiles = 0;
            long totalBoxes = 0;
            List<String> failures = new ArrayList<>();

            for (Path inputPath : inputFiles) {
                Path outputPath = outputDir.resolve(toOutputFileName(inputPath.getFileName().toString()));
                try {
                    ProcessResult result = processSingleFile(inputPath, outputPath, geometryMode);
                    ok++;
                    totalTiles += result.counter.tiles;
                    totalBoxes += result.counter.boxes;
                } catch (Exception e) {
                    failed++;
                    String detail = inputPath.getFileName() + ": " + e.getMessage();
                    failures.add(detail);
                    LittleTilesParityExporter.LOGGER.error("lt-debug-export failed for input {}", inputPath, e);
                }
            }

            String summary = "lt-debug-export processed " + inputFiles.size() + " files to " + outputDir +
                    " (ok=" + ok + ", failed=" + failed + ", tiles=" + totalTiles + ", boxes=" + totalBoxes + ", faceStates=" + EXPORT_FACE_STATES +
                    ", geometryMode=" + geometryMode.id + ")";
            source.sendSuccess(() -> Component.literal(summary), false);

            if (!failures.isEmpty()) {
                int maxLines = Math.min(5, failures.size());
                for (int i = 0; i < maxLines; i++)
                    source.sendFailure(Component.literal("  - " + failures.get(i)));
                if (failures.size() > maxLines)
                    source.sendFailure(Component.literal("  ... and " + (failures.size() - maxLines) + " more failures"));
            }
            return failed == 0 ? 1 : 0;
        } catch (Exception e) {
            source.sendFailure(Component.literal("lt-debug-export batch failed: " + e.getMessage()));
            LittleTilesParityExporter.LOGGER.error("lt-debug-export batch failed for inputDir {}", inputDir, e);
            return 0;
        }
    }

    private static ProcessResult processSingleFile(Path inputPath, Path outputPath, GeometryMode geometryMode) throws Exception {
        String rawSnbt = Files.readString(inputPath, StandardCharsets.UTF_8);
        CompoundTag parsedTag = TagParser.parseTag(rawSnbt);

        boolean legacy = OldLittleTilesDataParser.isOld(parsedTag);
        CompoundTag normalizedTag = legacy
                ? OldLittleTilesDataParser.convert(parsedTag.copy())
                : parsedTag.copy();

        LittleGroup root = LittleGroup.load(normalizedTag);

        Counter counter = new Counter();
        FaceStateSummary faceSummary = new FaceStateSummary();
        TransformableDiagnosticsSummary transformableDiagnostics = new TransformableDiagnosticsSummary();
        List<TileContext> allTiles = collectTileContexts(root);

        JsonObject report = new JsonObject();
        report.addProperty("generatedAt", Instant.now().toString());
        report.addProperty("schema", legacy ? "legacy" : "current");
        report.addProperty("inputPath", inputPath.toString());
        report.addProperty("outputPath", outputPath.toString());
        report.addProperty("normalizedSnbt", normalizedTag.toString());
        report.addProperty("outsideNeighborPolicy", "air");
        report.addProperty("withFaceStates", EXPORT_FACE_STATES);
        report.addProperty("geometryMode", geometryMode.id);
        report.add("runtime", buildRuntimeMetadata());

        JsonObject rootJson = encodeGroup(root, "root", counter, allTiles, faceSummary, transformableDiagnostics, geometryMode);
        report.add("root", rootJson);

        JsonObject statsJson = new JsonObject();
        statsJson.addProperty("groups", counter.groups);
        statsJson.addProperty("tiles", counter.tiles);
        statsJson.addProperty("boxes", counter.boxes);
        statsJson.addProperty("transformableBoxes", counter.transformableBoxes);
        statsJson.addProperty("facesEvaluated", faceSummary.totalFaces);
        statsJson.addProperty("renderableFaces", faceSummary.renderableFaces);
        report.add("stats", statsJson);

        report.add("faceStateSummary", faceSummary.toJson());
        report.add("transformableDiagnosticsSummary", transformableDiagnostics.toJson());

        Files.createDirectories(outputPath.getParent());
        Files.writeString(outputPath, GSON.toJson(report) + System.lineSeparator(), StandardCharsets.UTF_8);
        return new ProcessResult(counter);
    }

    private static JsonObject buildRuntimeMetadata() {
        JsonObject out = new JsonObject();
        out.addProperty("minecraftVersion", detectMinecraftVersion());
        out.addProperty("littleTilesVersion", detectLoadedModVersion("littletiles"));
        out.addProperty("creativeCoreVersion", detectLoadedModVersion("creativecore"));
        out.addProperty("parityExporterVersion", detectLoadedModVersion(LittleTilesParityExporter.MOD_ID));
        return out;
    }

    private static String detectMinecraftVersion() {
        try {
            return SharedConstants.getCurrentVersion().getName();
        } catch (Exception ignored) {
            return "unknown";
        }
    }

    private static String detectLoadedModVersion(String modId) {
        try {
            return ModList.get()
                    .getModContainerById(modId)
                    .map(container -> container.getModInfo().getVersion().toString())
                    .orElse("missing");
        } catch (Exception ignored) {
            return "unknown";
        }
    }

    private static JsonObject encodeGroup(
            LittleGroup group,
            String path,
            Counter counter,
            List<TileContext> allTiles,
            FaceStateSummary faceSummary,
            TransformableDiagnosticsSummary transformableDiagnostics,
            GeometryMode geometryMode) {
        counter.groups++;

        JsonObject out = new JsonObject();
        out.addProperty("path", path);
        out.addProperty("grid", group.getGrid().count);
        out.addProperty("structureId", group.getStructureId());
        out.addProperty("structureName", group.getStructureName());

        DebugParentCollection parent = new DebugParentCollection(group);

        JsonArray tiles = new JsonArray();
        int tileIndex = 0;
        for (LittleTile tile : group) {
            counter.tiles++;
            int currentTileIndex = tileIndex++;
            TileContext rendered = new TileContext(parent, tile);

            JsonObject tileJson = new JsonObject();
            tileJson.addProperty("index", currentTileIndex);
            tileJson.addProperty("blockState", tile.getBlockName());
            tileJson.addProperty("color", tile.color);

            JsonArray boxes = new JsonArray();
            int boxIndex = 0;
            for (LittleBox box : tile) {
                counter.boxes++;
                boolean transformable = box instanceof LittleTransformableBox;
                if (transformable)
                    counter.transformableBoxes++;
                int currentBoxIndex = boxIndex++;

                JsonObject boxJson = new JsonObject();
                boxJson.addProperty("index", currentBoxIndex);
                boxJson.addProperty("kind", transformable ? "transformable" : "aabb");
                boxJson.addProperty("minX", box.minX);
                boxJson.addProperty("minY", box.minY);
                boxJson.addProperty("minZ", box.minZ);
                boxJson.addProperty("maxX", box.maxX);
                boxJson.addProperty("maxY", box.maxY);
                boxJson.addProperty("maxZ", box.maxZ);
                boxJson.add("array", toIntArrayJson(box.getArray()));
                if (transformable)
                    boxJson.add("transformPayload", encodeTransformPayloadDiagnostics((LittleTransformableBox) box));

                boxJson.add("faceStates", encodeFaceStates(
                        path,
                        currentTileIndex,
                        currentBoxIndex,
                        rendered,
                        box,
                        allTiles,
                        faceSummary,
                        transformableDiagnostics,
                        geometryMode));

                boxes.add(boxJson);
            }
            tileJson.add("boxes", boxes);
            tiles.add(tileJson);
        }
        out.add("tiles", tiles);

        JsonArray children = new JsonArray();
        int childIndex = 0;
        for (LittleGroup child : group.children.all()) {
            String childPath = path + ".children[" + childIndex + "]";
            children.add(encodeGroup(child, childPath, counter, allTiles, faceSummary, transformableDiagnostics, geometryMode));
            childIndex++;
        }
        out.add("children", children);
        return out;
    }

    private static JsonArray encodeFaceStates(
            String groupPath,
            int tileIndex,
            int boxIndex,
            TileContext rendered,
            LittleBox renderedBox,
            List<TileContext> allTiles,
            FaceStateSummary summary,
            TransformableDiagnosticsSummary transformableDiagnostics,
            GeometryMode geometryMode) {
        JsonArray out = new JsonArray();
        LittleServerFace workingFace = new LittleServerFace(null);
        for (Facing facing : Facing.VALUES) {
            FaceEvaluation evaluation = evaluateFace(rendered, renderedBox, facing, allTiles, workingFace, geometryMode);
            out.add(evaluation.toJson());
            summary.record(evaluation);
            transformableDiagnostics.record(groupPath, tileIndex, boxIndex, evaluation);
        }
        return out;
    }

    private static FaceEvaluation evaluateFace(
            TileContext rendered,
            LittleBox renderedBox,
            Facing facing,
            List<TileContext> allTiles,
            LittleServerFace workingFace,
            GeometryMode geometryMode) {
        TransformableFaceCacheDebug transformableCache = snapshotTransformableFaceCache(rendered, renderedBox, facing);
        boolean generateFaceCurrentNull = transformableCache != null
                ? transformableCache.generateFaceCurrentNull
                : renderedBox.generateFace(rendered.parent.getGrid(), facing) == null;

        boolean clientTiltedOnlyRenderable = geometryMode == GeometryMode.CLIENT
                && transformableCache != null
                && generateFaceCurrentNull
                // Client render parity is based on facing-assigned tilted render strips.
                // hasTiltedStrip reflects raw source strips and can disagree with rendered facing assignment.
                && transformableCache.tiltedRenderCount > 0;

        if (clientTiltedOnlyRenderable)
            return evaluateClientTiltedOnlyFace(rendered, renderedBox, facing, transformableCache);

        if (generateFaceCurrentNull)
            return FaceEvaluation.unloaded(facing, transformableCache);

        workingFace.set(rendered.parent, rendered.tile, renderedBox, facing);

        boolean outside = !workingFace.isFaceInsideBlock();
        if (outside) {
            if (!rendered.tile.cullOverEdge())
                return FaceEvaluation.outside(facing, LittleFaceState.OUTSIDE_UNCOVERED, "outside_cull_over_edge_disabled", workingFace, transformableCache);
            return FaceEvaluation.outside(facing, LittleFaceState.OUTSIDE_UNCOVERED, "outside_assume_air_neighbour", workingFace, transformableCache);
        }

        FaceEvaluation evaluation = FaceEvaluation.inside(facing, workingFace, transformableCache);
        for (TileContext candidate : allTiles) {
            evaluation.evaluatedTiles++;

            if (candidate.parent.isStructure() && LittleStructureAttribute.noCollision(candidate.parent.getAttribute())) {
                evaluation.skippedNoCollisionStructureTiles++;
                continue;
            }

            boolean providesSolidFace = candidate.tile.doesProvideSolidFace();
            boolean renderCombined = candidate.tile.canBeRenderCombined(rendered.tile);
            if (!(providesSolidFace || renderCombined)) {
                evaluation.skippedIneligibleTiles++;
                continue;
            }

            evaluation.eligibleTiles++;
            if (providesSolidFace)
                evaluation.eligibleSolidFaceTiles++;
            else
                evaluation.eligibleRenderCombinedOnlyTiles++;

            candidate.tile.fillFace(candidate.parent, workingFace, candidate.parent.getGrid());
        }

        evaluation.filledCells = countFilledCells(workingFace.filled);
        if (workingFace.isFilled()) {
            evaluation.state = LittleFaceState.INSIDE_COVERED;
            evaluation.reason = "inside_covered";
        } else if (workingFace.isPartiallyFilled()) {
            evaluation.state = LittleFaceState.INSIDE_PARTIALLY_COVERED;
            evaluation.reason = "inside_partially_covered";
        } else {
            evaluation.state = LittleFaceState.INSIDE_UNCOVERED;
            evaluation.reason = "inside_uncovered";
        }
        return evaluation;
    }

    private static FaceEvaluation evaluateClientTiltedOnlyFace(
            TileContext rendered,
            LittleBox renderedBox,
            Facing facing,
            TransformableFaceCacheDebug transformableCache) {
        int totalCells = estimateFaceCellCount(renderedBox, facing);
        boolean outside = isOutsideFace(renderedBox, rendered.parent.getGrid(), facing);
        if (outside) {
            if (!rendered.tile.cullOverEdge())
                return FaceEvaluation.simple(
                        facing,
                        LittleFaceState.OUTSIDE_UNCOVERED,
                        "outside_cull_over_edge_disabled",
                        totalCells,
                        0,
                        transformableCache);
            return FaceEvaluation.simple(
                    facing,
                    LittleFaceState.OUTSIDE_UNCOVERED,
                    "outside_assume_air_neighbour",
                    totalCells,
                    0,
                    transformableCache);
        }
        return FaceEvaluation.simple(
                facing,
                LittleFaceState.INSIDE_UNCOVERED,
                "inside_uncovered",
                totalCells,
                0,
                transformableCache);
    }

    private static int estimateFaceCellCount(LittleBox box, Facing facing) {
        int oneSpan = Math.max(0, box.getMax(facing.one()) - box.getMin(facing.one()));
        int twoSpan = Math.max(0, box.getMax(facing.two()) - box.getMin(facing.two()));
        return oneSpan * twoSpan;
    }

    private static boolean isOutsideFace(LittleBox box, LittleGrid grid, Facing facing) {
        int origin = facing.positive ? box.getMax(facing.axis) : box.getMin(facing.axis);
        return !(origin > 0 && origin < grid.count);
    }

    private static TransformableFaceCacheDebug snapshotTransformableFaceCache(TileContext rendered, LittleBox box, Facing facing) {
        if (!(box instanceof LittleTransformableBox transformable))
            return null;

        TransformableFaceCacheSnapshot current = snapshotTransformableFaceCacheState(transformable, facing);
        LittleTransformableBox freshCopy = transformable.copy();
        freshCopy.requestCache();
        TransformableFaceCacheSnapshot fresh = snapshotTransformableFaceCacheState(freshCopy, facing);

        boolean generateFaceCurrentNull = transformable.generateFace(rendered.parent.getGrid(), facing) == null;
        boolean generateFaceFreshNull = freshCopy.generateFace(rendered.parent.getGrid(), facing) == null;
        boolean setCurrentResult = probeSetResult(rendered, transformable, facing);
        boolean setFreshResult = probeSetResult(rendered, freshCopy, facing);

        return new TransformableFaceCacheDebug(
                current,
                fresh,
                generateFaceCurrentNull,
                generateFaceFreshNull,
                setCurrentResult,
                setFreshResult);
    }

    private static TransformableFaceCacheSnapshot snapshotTransformableFaceCacheState(
            LittleTransformableBox transformable,
            Facing facing) {
        VectorFanFaceCache faceCache = transformable.requestCache().get(facing);
        if (faceCache == null)
            return TransformableFaceCacheSnapshot.empty();

        int tiltedRenderCount = 0;
        Iterable<?> tiltedSorted = faceCache.tiltedSorted();
        if (tiltedSorted != null) {
            for (Object ignored : tiltedSorted)
                tiltedRenderCount++;
        }

        return new TransformableFaceCacheSnapshot(
                faceCache.axisStrips.size(),
                tiltedRenderCount,
                faceCache.hasAxisStrip(),
                faceCache.hasTiltedStrip(),
                faceCache.isCompletelyFilled());
    }

    private static boolean probeSetResult(TileContext rendered, LittleBox box, Facing facing) {
        LittleServerFace probeFace = new LittleServerFace(null);
        probeFace.set(rendered.parent, rendered.tile, box, facing);
        return box.set(probeFace, rendered.parent.getGrid(), facing);
    }

    private static JsonObject encodeTransformPayloadDiagnostics(LittleTransformableBox transformable) {
        JsonObject out = new JsonObject();
        int indicator = transformable.getIndicator();
        int[] serialized = transformable.getArray();
        int transformPayloadIntCount = Math.max(0, serialized.length - 6);
        int transformDataWordCount = Math.max(0, transformPayloadIntCount - 1);
        int activeShortCount = Integer.bitCount(indicator & 0x00FFFFFF);

        out.addProperty("indicatorSigned", indicator);
        out.addProperty("indicatorUnsignedHex", String.format("0x%08X", indicator));
        out.addProperty("indicatorUnsignedBits", toUnsignedBitString32(indicator));
        out.add("flipBitsByFacing", encodeFlipBitsByFacing(transformable));
        out.addProperty("transformPayloadIntCount", transformPayloadIntCount);
        out.addProperty("transformDataWordCount", transformDataWordCount);
        out.addProperty("activeShortCountFromIndicator", activeShortCount);
        out.addProperty("packedShortCapacityFromWords", transformDataWordCount * 2);
        out.addProperty("activeShortCountExceedsPackedCapacity", activeShortCount > transformDataWordCount * 2);
        out.add("decodedCorners", encodeDecodedCorners(transformable));
        return out;
    }

    private static JsonObject encodeFlipBitsByFacing(LittleTransformableBox transformable) {
        JsonObject out = new JsonObject();
        for (Facing facing : Facing.VALUES)
            out.addProperty(facing.name(), transformable.getFlipped(facing));
        return out;
    }

    private static JsonArray encodeDecodedCorners(LittleTransformableBox transformable) {
        JsonArray out = new JsonArray();
        BoxCorner[] corners = BoxCorner.values();
        LittleVec[] baseCorners = transformable.getCorners();
        Vec3f[] transformedCorners = transformable.getTiltedCorners();

        for (int index = 0; index < corners.length; index++) {
            JsonObject corner = new JsonObject();
            corner.addProperty("corner", corners[index].name());
            corner.addProperty("index", index);

            LittleVec base = index < baseCorners.length ? baseCorners[index] : null;
            Vec3f transformed = index < transformedCorners.length ? transformedCorners[index] : null;
            if (base != null)
                corner.add("base", toIntVectorJson(base.x, base.y, base.z));
            if (transformed != null)
                corner.add("transformed", toFloatVectorJson(transformed.x, transformed.y, transformed.z));
            if (base != null && transformed != null) {
                corner.add("delta", toFloatVectorJson(
                        transformed.x - base.x,
                        transformed.y - base.y,
                        transformed.z - base.z));
            }
            out.add(corner);
        }
        return out;
    }

    private static JsonObject toIntVectorJson(int x, int y, int z) {
        JsonObject out = new JsonObject();
        out.addProperty("x", x);
        out.addProperty("y", y);
        out.addProperty("z", z);
        return out;
    }

    private static JsonObject toFloatVectorJson(float x, float y, float z) {
        JsonObject out = new JsonObject();
        out.addProperty("x", x);
        out.addProperty("y", y);
        out.addProperty("z", z);
        return out;
    }

    private static String toUnsignedBitString32(int value) {
        String bits = Integer.toBinaryString(value);
        if (bits.length() >= 32)
            return bits;
        return "0".repeat(32 - bits.length()) + bits;
    }

    private static List<TileContext> collectTileContexts(LittleGroup root) {
        List<TileContext> out = new ArrayList<>();
        collectTileContexts(root, out);
        return out;
    }

    private static void collectTileContexts(LittleGroup group, List<TileContext> out) {
        DebugParentCollection parent = new DebugParentCollection(group);
        for (LittleTile tile : group)
            out.add(new TileContext(parent, tile));

        for (LittleGroup child : group.children.all())
            collectTileContexts(child, out);
    }

    private static int countFilledCells(boolean[][] filled) {
        if (filled == null || filled.length == 0)
            return 0;
        int out = 0;
        for (int one = 0; one < filled.length; one++)
            for (int two = 0; two < filled[one].length; two++)
                if (filled[one][two])
                    out++;
        return out;
    }

    private static JsonArray toIntArrayJson(int[] values) {
        JsonArray out = new JsonArray();
        for (int value : values)
            out.add(value);
        return out;
    }

    private static Path resolvePath(MinecraftServer server, String raw) {
        Path path = Path.of(raw);
        if (path.isAbsolute())
            return path.normalize();
        return server.getFile(raw).normalize();
    }

    private static String toOutputFileName(String inputFileName) {
        int dot = inputFileName.lastIndexOf('.');
        String base = dot > 0 ? inputFileName.substring(0, dot) : inputFileName;
        if (base.isBlank())
            base = inputFileName;
        return base + ".json";
    }

    private static final class TileContext {
        final DebugParentCollection parent;
        final LittleTile tile;

        TileContext(DebugParentCollection parent, LittleTile tile) {
            this.parent = parent;
            this.tile = tile;
        }
    }

    private static final class DebugParentCollection implements IParentCollection {
        private final LittleGroup group;
        private final int attribute;

        DebugParentCollection(LittleGroup group) {
            this.group = group;
            this.attribute = resolveAttribute(group);
        }

        private static int resolveAttribute(LittleGroup group) {
            if (!group.hasStructure())
                return LittleStructureAttribute.NONE;
            LittleStructureType type = group.getStructureType();
            if (type == null)
                return LittleStructureAttribute.NONE;
            return type.attribute;
        }

        @Override
        public int size() {
            int out = 0;
            for (LittleTile ignored : group)
                out++;
            return out;
        }

        @Override
        public int totalSize() {
            return size();
        }

        @Override
        public boolean isStructure() {
            return group.hasStructure();
        }

        @Override
        public boolean isStructureChild(LittleStructure structure) {
            return false;
        }

        @Override
        public boolean isMain() {
            return false;
        }

        @Override
        public LittleStructure getStructure() throws CorruptedConnectionException, NotYetConnectedException {
            return null;
        }

        @Override
        public int getAttribute() {
            return attribute;
        }

        @Override
        public void setAttribute(int attribute) {}

        @Override
        public boolean isClient() {
            return false;
        }

        @Override
        public BETiles getBE() {
            return null;
        }

        @Override
        public Level getLevel() {
            return null;
        }

        @Override
        public LittleGrid getGrid() {
            return group.getGrid();
        }

        @Override
        public Iterator<LittleTile> iterator() {
            return group.iterator();
        }
    }

    private static final class FaceEvaluation {
        final Facing facing;
        final TransformableFaceCacheDebug transformableCache;
        LittleFaceState state;
        String reason;
        int totalCells;
        int filledCells;
        int evaluatedTiles;
        int eligibleTiles;
        int eligibleSolidFaceTiles;
        int eligibleRenderCombinedOnlyTiles;
        int skippedNoCollisionStructureTiles;
        int skippedIneligibleTiles;

        private FaceEvaluation(
                Facing facing,
                LittleFaceState state,
                String reason,
                int totalCells,
                int filledCells,
                TransformableFaceCacheDebug transformableCache) {
            this.facing = facing;
            this.state = state;
            this.reason = reason;
            this.totalCells = totalCells;
            this.filledCells = filledCells;
            this.transformableCache = transformableCache;
        }

        static FaceEvaluation unloaded(Facing facing, TransformableFaceCacheDebug transformableCache) {
            return new FaceEvaluation(facing, LittleFaceState.UNLOADED, "face_unloaded", 0, 0, transformableCache);
        }

        static FaceEvaluation outside(
                Facing facing,
                LittleFaceState state,
                String reason,
                LittleServerFace face,
                TransformableFaceCacheDebug transformableCache) {
            int totalCells = Math.max(0, (face.maxOne() - face.minOne()) * (face.maxTwo() - face.minTwo()));
            return new FaceEvaluation(facing, state, reason, totalCells, 0, transformableCache);
        }

        static FaceEvaluation inside(Facing facing, LittleServerFace face, TransformableFaceCacheDebug transformableCache) {
            int totalCells = Math.max(0, (face.maxOne() - face.minOne()) * (face.maxTwo() - face.minTwo()));
            return new FaceEvaluation(facing, LittleFaceState.INSIDE_UNCOVERED, "inside_uncovered", totalCells, 0, transformableCache);
        }

        static FaceEvaluation simple(
                Facing facing,
                LittleFaceState state,
                String reason,
                int totalCells,
                int filledCells,
                TransformableFaceCacheDebug transformableCache) {
            return new FaceEvaluation(facing, state, reason, totalCells, filledCells, transformableCache);
        }

        boolean renderable() {
            return state != LittleFaceState.UNLOADED && !state.coveredFully();
        }

        JsonObject toJson() {
            JsonObject out = new JsonObject();
            out.addProperty("facing", facing.name());
            out.addProperty("state", state.name());
            out.addProperty("outside", state.outside());
            out.addProperty("coveredFully", state.coveredFully());
            out.addProperty("partially", state.partially());
            out.addProperty("renderable", renderable());
            out.addProperty("reason", reason);
            out.addProperty("filledCells", filledCells);
            out.addProperty("totalCells", totalCells);
            out.addProperty("evaluatedTiles", evaluatedTiles);
            out.addProperty("eligibleTiles", eligibleTiles);
            out.addProperty("eligibleSolidFaceTiles", eligibleSolidFaceTiles);
            out.addProperty("eligibleRenderCombinedOnlyTiles", eligibleRenderCombinedOnlyTiles);
            out.addProperty("skippedNoCollisionStructureTiles", skippedNoCollisionStructureTiles);
            out.addProperty("skippedIneligibleTiles", skippedIneligibleTiles);
            if (transformableCache != null)
                out.add("transformableCache", transformableCache.toJson());
            return out;
        }
    }

    private static final class TransformableFaceCacheSnapshot {
        final int axisStripCount;
        final int tiltedRenderCount;
        final boolean hasAxisStrip;
        final boolean hasTiltedStrip;
        final boolean isCompletelyFilled;

        TransformableFaceCacheSnapshot(
                int axisStripCount,
                int tiltedRenderCount,
                boolean hasAxisStrip,
                boolean hasTiltedStrip,
                boolean isCompletelyFilled) {
            this.axisStripCount = axisStripCount;
            this.tiltedRenderCount = tiltedRenderCount;
            this.hasAxisStrip = hasAxisStrip;
            this.hasTiltedStrip = hasTiltedStrip;
            this.isCompletelyFilled = isCompletelyFilled;
        }

        static TransformableFaceCacheSnapshot empty() {
            return new TransformableFaceCacheSnapshot(0, 0, false, false, false);
        }

        JsonObject toJson() {
            JsonObject out = new JsonObject();
            out.addProperty("axisStripCount", axisStripCount);
            out.addProperty("tiltedRenderCount", tiltedRenderCount);
            out.addProperty("hasAxisStrip", hasAxisStrip);
            out.addProperty("hasTiltedStrip", hasTiltedStrip);
            out.addProperty("isCompletelyFilled", isCompletelyFilled);
            return out;
        }
    }

    private static final class TransformableFaceCacheDebug {
        final int axisStripCount;
        final int tiltedRenderCount;
        final boolean hasAxisStrip;
        final boolean hasTiltedStrip;
        final boolean isCompletelyFilled;
        final TransformableFaceCacheSnapshot current;
        final TransformableFaceCacheSnapshot fresh;
        final boolean currentVsFreshMismatch;
        final boolean axisStripCountMismatch;
        final boolean tiltedRenderCountMismatch;
        final boolean hasAxisStripMismatch;
        final boolean hasTiltedStripMismatch;
        final boolean isCompletelyFilledMismatch;
        final boolean generateFaceCurrentNull;
        final boolean generateFaceFreshNull;
        final boolean generateFaceNullMismatch;
        final boolean setCurrentResult;
        final boolean setFreshResult;
        final boolean setResultMismatch;

        TransformableFaceCacheDebug(
                TransformableFaceCacheSnapshot current,
                TransformableFaceCacheSnapshot fresh,
                boolean generateFaceCurrentNull,
                boolean generateFaceFreshNull,
                boolean setCurrentResult,
                boolean setFreshResult) {
            this.current = current != null ? current : TransformableFaceCacheSnapshot.empty();
            this.fresh = fresh != null ? fresh : TransformableFaceCacheSnapshot.empty();
            this.axisStripCount = this.current.axisStripCount;
            this.tiltedRenderCount = this.current.tiltedRenderCount;
            this.hasAxisStrip = this.current.hasAxisStrip;
            this.hasTiltedStrip = this.current.hasTiltedStrip;
            this.isCompletelyFilled = this.current.isCompletelyFilled;
            this.axisStripCountMismatch = this.current.axisStripCount != this.fresh.axisStripCount;
            this.tiltedRenderCountMismatch = this.current.tiltedRenderCount != this.fresh.tiltedRenderCount;
            this.hasAxisStripMismatch = this.current.hasAxisStrip != this.fresh.hasAxisStrip;
            this.hasTiltedStripMismatch = this.current.hasTiltedStrip != this.fresh.hasTiltedStrip;
            this.isCompletelyFilledMismatch = this.current.isCompletelyFilled != this.fresh.isCompletelyFilled;
            this.currentVsFreshMismatch = axisStripCountMismatch
                    || tiltedRenderCountMismatch
                    || hasAxisStripMismatch
                    || hasTiltedStripMismatch
                    || isCompletelyFilledMismatch;
            this.generateFaceCurrentNull = generateFaceCurrentNull;
            this.generateFaceFreshNull = generateFaceFreshNull;
            this.generateFaceNullMismatch = generateFaceCurrentNull != generateFaceFreshNull;
            this.setCurrentResult = setCurrentResult;
            this.setFreshResult = setFreshResult;
            this.setResultMismatch = setCurrentResult != setFreshResult;
        }

        JsonObject toJson() {
            JsonObject out = new JsonObject();
            out.addProperty("axisStripCount", axisStripCount);
            out.addProperty("tiltedRenderCount", tiltedRenderCount);
            out.addProperty("hasAxisStrip", hasAxisStrip);
            out.addProperty("hasTiltedStrip", hasTiltedStrip);
            out.addProperty("isCompletelyFilled", isCompletelyFilled);
            out.add("current", current.toJson());
            out.add("fresh", fresh.toJson());
            out.addProperty("currentVsFreshMismatch", currentVsFreshMismatch);

            JsonObject fieldMismatches = new JsonObject();
            fieldMismatches.addProperty("axisStripCount", axisStripCountMismatch);
            fieldMismatches.addProperty("tiltedRenderCount", tiltedRenderCountMismatch);
            fieldMismatches.addProperty("hasAxisStrip", hasAxisStripMismatch);
            fieldMismatches.addProperty("hasTiltedStrip", hasTiltedStripMismatch);
            fieldMismatches.addProperty("isCompletelyFilled", isCompletelyFilledMismatch);
            out.add("fieldMismatches", fieldMismatches);

            out.addProperty("generateFaceCurrentNull", generateFaceCurrentNull);
            out.addProperty("generateFaceFreshNull", generateFaceFreshNull);
            out.addProperty("generateFaceNullMismatch", generateFaceNullMismatch);
            out.addProperty("setCurrentResult", setCurrentResult);
            out.addProperty("setFreshResult", setFreshResult);
            out.addProperty("setResultMismatch", setResultMismatch);
            return out;
        }
    }

    private static final class FaceStateSummary {
        int totalFaces;
        int renderableFaces;
        int insideFaces;
        int outsideFaces;
        final EnumMap<LittleFaceState, Integer> byState = new EnumMap<>(LittleFaceState.class);
        final EnumMap<Facing, Integer> byFacing = new EnumMap<>(Facing.class);
        final Map<String, Integer> byReason = new HashMap<>();

        FaceStateSummary() {
            for (LittleFaceState state : LittleFaceState.values())
                byState.put(state, 0);
            for (Facing facing : Facing.VALUES)
                byFacing.put(facing, 0);
        }

        void record(FaceEvaluation face) {
            totalFaces++;
            byState.put(face.state, byState.get(face.state) + 1);
            byFacing.put(face.facing, byFacing.get(face.facing) + 1);
            byReason.put(face.reason, byReason.getOrDefault(face.reason, 0) + 1);
            if (face.state.outside())
                outsideFaces++;
            else
                insideFaces++;
            if (face.renderable())
                renderableFaces++;
        }

        JsonObject toJson() {
            JsonObject out = new JsonObject();
            out.addProperty("totalFaces", totalFaces);
            out.addProperty("renderableFaces", renderableFaces);
            out.addProperty("insideFaces", insideFaces);
            out.addProperty("outsideFaces", outsideFaces);
            out.add("byState", enumCountMapToJson(byState));
            out.add("byFacing", enumCountMapToJson(byFacing));
            out.add("byReason", stringCountMapToJson(byReason));
            return out;
        }
    }

    private static final class TransformableDiagnosticsSummary {
        private static final int SAMPLE_LIMIT = 16;

        int transformableFacesEvaluated;
        int currentVsFreshCacheMismatchFaces;
        int generateFaceCurrentVsFreshMismatchFaces;
        int setCurrentVsFreshMismatchFaces;
        final List<FaceLocationSample> cacheMismatchSamples = new ArrayList<>();
        final List<FaceLocationSample> generateFaceMismatchSamples = new ArrayList<>();
        final List<FaceLocationSample> setMismatchSamples = new ArrayList<>();

        void record(String path, int tileIndex, int boxIndex, FaceEvaluation face) {
            if (face.transformableCache == null)
                return;

            transformableFacesEvaluated++;
            if (face.transformableCache.currentVsFreshMismatch) {
                currentVsFreshCacheMismatchFaces++;
                addSample(cacheMismatchSamples, path, tileIndex, boxIndex, face.facing);
            }
            if (face.transformableCache.generateFaceNullMismatch) {
                generateFaceCurrentVsFreshMismatchFaces++;
                addSample(generateFaceMismatchSamples, path, tileIndex, boxIndex, face.facing);
            }
            if (face.transformableCache.setResultMismatch) {
                setCurrentVsFreshMismatchFaces++;
                addSample(setMismatchSamples, path, tileIndex, boxIndex, face.facing);
            }
        }

        private static void addSample(List<FaceLocationSample> samples, String path, int tileIndex, int boxIndex, Facing facing) {
            if (samples.size() >= SAMPLE_LIMIT)
                return;
            samples.add(new FaceLocationSample(path, tileIndex, boxIndex, facing));
        }

        JsonObject toJson() {
            JsonObject out = new JsonObject();
            out.addProperty("transformableFacesEvaluated", transformableFacesEvaluated);
            out.addProperty("currentVsFreshCacheMismatchFaces", currentVsFreshCacheMismatchFaces);
            out.addProperty("generateFaceCurrentVsFreshMismatchFaces", generateFaceCurrentVsFreshMismatchFaces);
            out.addProperty("setCurrentVsFreshMismatchFaces", setCurrentVsFreshMismatchFaces);
            out.add("cacheMismatchSamples", samplesToJson(cacheMismatchSamples));
            out.add("generateFaceMismatchSamples", samplesToJson(generateFaceMismatchSamples));
            out.add("setMismatchSamples", samplesToJson(setMismatchSamples));
            return out;
        }

        private static JsonArray samplesToJson(List<FaceLocationSample> samples) {
            JsonArray out = new JsonArray();
            for (FaceLocationSample sample : samples)
                out.add(sample.toJson());
            return out;
        }
    }

    private static final class FaceLocationSample {
        final String path;
        final int tileIndex;
        final int boxIndex;
        final Facing facing;

        FaceLocationSample(String path, int tileIndex, int boxIndex, Facing facing) {
            this.path = path;
            this.tileIndex = tileIndex;
            this.boxIndex = boxIndex;
            this.facing = facing;
        }

        JsonObject toJson() {
            JsonObject out = new JsonObject();
            out.addProperty("path", path);
            out.addProperty("tileIndex", tileIndex);
            out.addProperty("boxIndex", boxIndex);
            out.addProperty("facing", facing.name());
            return out;
        }
    }

    private static <E extends Enum<E>> JsonObject enumCountMapToJson(Map<E, Integer> map) {
        JsonObject out = new JsonObject();
        for (Map.Entry<E, Integer> entry : map.entrySet())
            out.addProperty(entry.getKey().name(), entry.getValue());
        return out;
    }

    private static JsonObject stringCountMapToJson(Map<String, Integer> map) {
        JsonObject out = new JsonObject();
        map.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(entry -> out.addProperty(entry.getKey(), entry.getValue()));
        return out;
    }

    private static final class Counter {
        int groups;
        int tiles;
        int boxes;
        int transformableBoxes;
    }

    private static final class ProcessResult {
        final Counter counter;

        ProcessResult(Counter counter) {
            this.counter = counter;
        }
    }
}
