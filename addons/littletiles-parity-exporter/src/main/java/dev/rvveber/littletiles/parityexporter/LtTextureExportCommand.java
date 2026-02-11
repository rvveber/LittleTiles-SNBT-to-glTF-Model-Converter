package dev.rvveber.littletiles.parityexporter;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Stream;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.TagParser;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.FoliageColor;
import team.creative.littletiles.common.block.little.tile.LittleTile;
import team.creative.littletiles.common.block.little.tile.group.LittleGroup;
import team.creative.littletiles.common.convertion.OldLittleTilesDataParser;

public final class LtTextureExportCommand {

    private static final Gson GSON = new GsonBuilder()
            .setPrettyPrinting()
            .disableHtmlEscaping()
            .create();

    private LtTextureExportCommand() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        LiteralArgumentBuilder<CommandSourceStack> root = Commands.literal("lt-texture-export")
                .requires(source -> source.hasPermission(2))
                .then(Commands.argument("input_dir", StringArgumentType.string())
                        .then(Commands.argument("output_dir", StringArgumentType.string())
                                .executes(context -> executeBatch(
                                        context.getSource(),
                                        StringArgumentType.getString(context, "input_dir"),
                                        StringArgumentType.getString(context, "output_dir")))));
        dispatcher.register(root);
    }

    private static int executeBatch(CommandSourceStack source, String inputDirArg, String outputDirArg) {
        MinecraftServer server = source.getServer();
        Path inputDir = resolvePath(server, inputDirArg);
        Path outputDir = resolvePath(server, outputDirArg);
        Path texturesRoot = outputDir.resolve("textures");
        TextureResolver resolver = new TextureResolver();

        try {
            if (!Files.isDirectory(inputDir)) {
                source.sendFailure(Component.literal("lt-texture-export failed: input path is not a directory: " + inputDir));
                return 0;
            }
            Files.createDirectories(outputDir);
            Files.createDirectories(texturesRoot);

            List<Path> inputFiles;
            try (Stream<Path> stream = Files.list(inputDir)) {
                inputFiles = stream
                        .filter(Files::isRegularFile)
                        .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                        .toList();
            }

            if (inputFiles.isEmpty()) {
                source.sendFailure(Component.literal("lt-texture-export failed: input directory has no files: " + inputDir));
                return 0;
            }

            int ok = 0;
            int failed = 0;
            long totalBlockStates = 0;
            long totalResolvedTextures = 0;
            long totalMissingTextures = 0;
            List<String> failures = new ArrayList<>();

            for (Path inputPath : inputFiles) {
                Path outputPath = outputDir.resolve(toOutputFileName(inputPath.getFileName().toString()));
                try {
                    TextureProcessResult result = processSingleFile(inputPath, outputPath, texturesRoot, resolver);
                    ok++;
                    totalBlockStates += result.blockStates;
                    totalResolvedTextures += result.resolvedTextures;
                    totalMissingTextures += result.missingTextures;
                } catch (Exception e) {
                    failed++;
                    String detail = inputPath.getFileName() + ": " + e.getMessage();
                    failures.add(detail);
                    LittleTilesParityExporter.LOGGER.error("lt-texture-export failed for input {}", inputPath, e);
                }
            }

            String summary = "lt-texture-export processed " + inputFiles.size() + " files to " + outputDir +
                    " (ok=" + ok + ", failed=" + failed +
                    ", blockStates=" + totalBlockStates +
                    ", texturesResolved=" + totalResolvedTextures +
                    ", missingTextures=" + totalMissingTextures + ")";
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
            source.sendFailure(Component.literal("lt-texture-export batch failed: " + e.getMessage()));
            LittleTilesParityExporter.LOGGER.error("lt-texture-export batch failed for inputDir {}", inputDir, e);
            return 0;
        }
    }

    private static TextureProcessResult processSingleFile(
            Path inputPath,
            Path outputPath,
            Path texturesRoot,
            TextureResolver resolver) throws Exception {
        String rawSnbt = Files.readString(inputPath, StandardCharsets.UTF_8);
        CompoundTag parsedTag = TagParser.parseTag(rawSnbt);
        boolean legacy = OldLittleTilesDataParser.isOld(parsedTag);
        CompoundTag normalizedTag = legacy
                ? OldLittleTilesDataParser.convert(parsedTag.copy())
                : parsedTag.copy();
        LittleGroup root = LittleGroup.load(normalizedTag);

        Set<BlockStateRef> blockStates = collectBlockStates(root);
        List<BlockStateRef> sortedStates = new ArrayList<>(blockStates);
        sortedStates.sort(Comparator.comparing(BlockStateRef::canonicalState));

        JsonObject report = new JsonObject();
        report.addProperty("generatedAt", Instant.now().toString());
        report.addProperty("schema", legacy ? "legacy" : "current");
        report.addProperty("inputPath", inputPath.toString());
        report.addProperty("outputPath", outputPath.toString());
        report.add("textureStrategy", buildTextureStrategyJson());

        JsonArray blockStatesJson = new JsonArray();
        Map<ResourceId, TextureExportInfo> fileTextures = new LinkedHashMap<>();
        Set<ResourceId> fileMissingTextures = new LinkedHashSet<>();
        Set<String> missingAssets = new LinkedHashSet<>();
        Set<ResourceId> fileModels = new LinkedHashSet<>();

        for (BlockStateRef state : sortedStates) {
            Set<ResourceId> models = resolver.resolveModelsForState(state, missingAssets);
            fileModels.addAll(models);
            Set<ResourceId> textures = resolver.resolveTexturesForModels(models, missingAssets);

            JsonObject blockJson = new JsonObject();
            blockJson.addProperty("blockState", state.rawState());
            blockJson.addProperty("canonicalState", state.canonicalState());
            blockJson.addProperty("blockId", state.blockId());
            blockJson.add("properties", toJsonObject(state.properties()));
            Integer tintColor = inferDefaultTintColor(state);
            if (tintColor != null) {
                blockJson.addProperty("tintColor", tintColor);
                blockJson.addProperty("tintColorHex", String.format("0x%06X", tintColor & 0xFFFFFF));
            }
            blockJson.add("models", toJsonArray(sortedResourceIdStrings(models)));

            JsonArray textureIds = new JsonArray();
            JsonArray missingTextureIds = new JsonArray();
            for (ResourceId textureId : sortedResourceIds(textures)) {
                TextureExportInfo exported = resolver.exportTexture(textureId, texturesRoot, missingAssets);
                textureIds.add(textureId.toString());
                fileTextures.putIfAbsent(textureId, exported);
                if (!exported.exported()) {
                    fileMissingTextures.add(textureId);
                    missingTextureIds.add(textureId.toString());
                }
            }

            blockJson.add("textureIds", textureIds);
            blockJson.add("missingTextureIds", missingTextureIds);
            blockStatesJson.add(blockJson);
        }

        report.add("blockStates", blockStatesJson);

        JsonArray texturesJson = new JsonArray();
        for (ResourceId textureId : sortedResourceIds(fileTextures.keySet()))
            texturesJson.add(fileTextures.get(textureId).toJson());
        report.add("textures", texturesJson);
        report.add("missingTextureIds", toJsonArray(sortedResourceIdStrings(fileMissingTextures)));
        report.add("missingAssets", toJsonArray(sortedStrings(missingAssets)));

        JsonObject stats = new JsonObject();
        stats.addProperty("blockStates", sortedStates.size());
        stats.addProperty("modelsReferenced", fileModels.size());
        stats.addProperty("texturesReferenced", fileTextures.size());
        stats.addProperty("texturesExported", fileTextures.values().stream().filter(TextureExportInfo::exported).count());
        stats.addProperty("missingTextures", fileMissingTextures.size());
        report.add("stats", stats);

        Files.createDirectories(outputPath.getParent());
        Files.writeString(outputPath, GSON.toJson(report) + System.lineSeparator(), StandardCharsets.UTF_8);

        return new TextureProcessResult(sortedStates.size(), fileTextures.size(), fileMissingTextures.size());
    }

    private static Set<BlockStateRef> collectBlockStates(LittleGroup root) {
        Set<BlockStateRef> out = new LinkedHashSet<>();
        collectBlockStates(root, out);
        return out;
    }

    private static void collectBlockStates(LittleGroup group, Set<BlockStateRef> out) {
        for (LittleTile tile : group)
            out.add(parseBlockStateRef(tile.getBlockName()));
        for (LittleGroup child : group.children.all())
            collectBlockStates(child, out);
    }

    private static BlockStateRef parseBlockStateRef(String raw) {
        String state = raw == null ? "minecraft:air" : raw.trim();
        if (state.isEmpty())
            state = "minecraft:air";

        int bracketStart = state.indexOf('[');
        int bracketEnd = state.lastIndexOf(']');
        String stateName = bracketStart >= 0 ? state.substring(0, bracketStart) : state;
        String propertyText = (bracketStart >= 0 && bracketEnd > bracketStart)
                ? state.substring(bracketStart + 1, bracketEnd)
                : "";

        String blockId = normalizeBlockId(stateName);
        ResourceId blockResource = ResourceId.parse(blockId, "minecraft");
        Map<String, String> properties = parseStateProperties(propertyText);
        String canonicalState = canonicalStateString(blockResource, properties);

        return new BlockStateRef(state, canonicalState, blockResource.toString(), blockResource.namespace(), blockResource.path(), properties);
    }

    private static String normalizeBlockId(String value) {
        String id = value == null ? "" : value.trim();
        if (id.isEmpty())
            return "minecraft:air";
        if (id.matches("^[^:]+:[^:]+:-?\\d+$"))
            return id.replaceFirst(":-?\\d+$", "");
        if (!id.contains(":"))
            return "minecraft:" + id;
        return id;
    }

    private static Map<String, String> parseStateProperties(String text) {
        if (text == null || text.isBlank())
            return Map.of();

        Map<String, String> out = new TreeMap<>();
        String[] entries = text.split(",");
        for (String entry : entries) {
            String pair = entry.trim();
            if (pair.isEmpty())
                continue;
            int equals = pair.indexOf('=');
            if (equals <= 0 || equals >= pair.length() - 1)
                continue;
            String key = pair.substring(0, equals).trim();
            String value = pair.substring(equals + 1).trim();
            if (!key.isEmpty() && !value.isEmpty())
                out.put(key, value);
        }
        return Collections.unmodifiableMap(out);
    }

    private static String canonicalStateString(ResourceId blockId, Map<String, String> properties) {
        if (properties.isEmpty())
            return blockId.toString();

        StringBuilder out = new StringBuilder();
        out.append(blockId).append('[');
        boolean first = true;
        for (Map.Entry<String, String> entry : properties.entrySet()) {
            if (!first)
                out.append(',');
            out.append(entry.getKey()).append('=').append(entry.getValue());
            first = false;
        }
        out.append(']');
        return out.toString();
    }

    /**
     * Exporter-side default tint metadata for biome-tinted blocks.
     *
     * We cannot evaluate full biome context in this batch export command, so we provide
     * deterministic defaults aligned with vanilla foliage tint behavior.
     */
    private static Integer inferDefaultTintColor(BlockStateRef state) {
        String blockId = state.blockId();
        String rawName = state.rawState();
        if (rawName == null)
            rawName = blockId;

        String loweredRaw = rawName.toLowerCase(Locale.ROOT);
        String loweredId = blockId.toLowerCase(Locale.ROOT);

        // Legacy 1.12 leaves ids with metadata (`minecraft:leaves:2`, etc.).
        if (loweredRaw.startsWith("minecraft:leaves:")) {
            int meta = parseLegacyMetaSuffix(loweredRaw);
            return switch (meta) {
                case 1 -> FoliageColor.getEvergreenColor(); // spruce
                case 2 -> FoliageColor.getBirchColor();     // birch
                default -> FoliageColor.getDefaultColor();  // oak/jungle fallback
            };
        }
        if (loweredRaw.startsWith("minecraft:leaves2:")) {
            return FoliageColor.getDefaultColor(); // acacia/dark_oak fallback
        }

        // Modern leaves ids.
        if (loweredId.contains("spruce_leaves"))
            return FoliageColor.getEvergreenColor();
        if (loweredId.contains("birch_leaves"))
            return FoliageColor.getBirchColor();
        if (loweredId.contains("leaves"))
            return FoliageColor.getDefaultColor();

        return null;
    }

    private static int parseLegacyMetaSuffix(String value) {
        int split = value.lastIndexOf(':');
        if (split < 0 || split >= value.length() - 1)
            return -1;
        try {
            return Integer.parseInt(value.substring(split + 1));
        } catch (Exception ignored) {
            return -1;
        }
    }

    private static JsonObject buildTextureStrategyJson() {
        JsonObject out = new JsonObject();
        out.addProperty("source", "assets/<namespace>/blockstates + models + textures resources");
        out.addProperty("textureFormat", "png");
        out.addProperty("uriPattern", "textures/<namespace>/<path>.png");
        out.addProperty("atlasIndependent", true);
        out.addProperty("browserCacheFriendly", true);
        out.addProperty("textureAtlasRequired", false);

        JsonArray notes = new JsonArray();
        notes.add("Resolves per-block textures from blockstate/model graph, not stitched atlas coordinates.");
        notes.add("Exports external image files suitable for direct glTF image URIs.");
        notes.add("Future optimization path: offline transcode to KTX2 while preserving stable per-texture URIs.");
        out.add("notes", notes);
        return out;
    }

    private static JsonObject toJsonObject(Map<String, String> values) {
        JsonObject out = new JsonObject();
        for (Map.Entry<String, String> entry : values.entrySet())
            out.addProperty(entry.getKey(), entry.getValue());
        return out;
    }

    private static JsonArray toJsonArray(List<String> values) {
        JsonArray out = new JsonArray();
        for (String value : values)
            out.add(value);
        return out;
    }

    private static List<ResourceId> sortedResourceIds(Collection<ResourceId> values) {
        List<ResourceId> out = new ArrayList<>(values);
        out.sort(Comparator.comparing(ResourceId::namespace).thenComparing(ResourceId::path));
        return out;
    }

    private static List<String> sortedResourceIdStrings(Collection<ResourceId> values) {
        List<String> out = new ArrayList<>();
        for (ResourceId value : sortedResourceIds(values))
            out.add(value.toString());
        return out;
    }

    private static List<String> sortedStrings(Collection<String> values) {
        List<String> out = new ArrayList<>(values);
        out.sort(String::compareTo);
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
        return base + ".textures.json";
    }

    private record TextureProcessResult(int blockStates, int resolvedTextures, int missingTextures) {}

    private record BlockStateRef(
            String rawState,
            String canonicalState,
            String blockId,
            String namespace,
            String path,
            Map<String, String> properties) {}

    private record ResourceId(String namespace, String path) {
        ResourceId {
            namespace = normalizeNamespace(namespace);
            path = normalizePath(path);
        }

        static ResourceId parse(String raw, String defaultNamespace) {
            if (raw == null)
                return new ResourceId(defaultNamespace, "air");
            String value = raw.trim();
            if (value.startsWith("#"))
                value = value.substring(1);
            if (value.isEmpty())
                return new ResourceId(defaultNamespace, "air");

            int split = value.indexOf(':');
            if (split < 0)
                return new ResourceId(defaultNamespace, value);

            String namespace = value.substring(0, split);
            String path = value.substring(split + 1);
            if (path.isEmpty())
                path = "air";
            return new ResourceId(namespace, path);
        }

        @Override
        public String toString() {
            return namespace + ":" + path;
        }

        private static String normalizeNamespace(String value) {
            String out = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
            return out.isEmpty() ? "minecraft" : out;
        }

        private static String normalizePath(String value) {
            String out = value == null ? "" : value.trim();
            if (out.startsWith("/"))
                out = out.substring(1);
            return out.isEmpty() ? "air" : out;
        }
    }

    private static final class TextureExportInfo {
        private final ResourceId textureId;
        private final String sourcePath;
        private final String uri;
        private final boolean exported;
        private final boolean hasMcmeta;

        TextureExportInfo(ResourceId textureId, String sourcePath, String uri, boolean exported, boolean hasMcmeta) {
            this.textureId = textureId;
            this.sourcePath = sourcePath;
            this.uri = uri;
            this.exported = exported;
            this.hasMcmeta = hasMcmeta;
        }

        boolean exported() {
            return exported;
        }

        JsonObject toJson() {
            JsonObject out = new JsonObject();
            out.addProperty("id", textureId.toString());
            out.addProperty("sourcePath", sourcePath);
            out.addProperty("uri", uri);
            out.addProperty("exported", exported);
            out.addProperty("hasMcmeta", hasMcmeta);
            return out;
        }
    }

    private static final class TextureResolver {
        private final ClassLoader classLoader = LtTextureExportCommand.class.getClassLoader();
        private final Map<String, JsonObject> jsonObjectCache = new HashMap<>();
        private final Set<String> jsonObjectMissing = new HashSet<>();
        private final Map<ResourceId, Map<String, String>> modelTexturesCache = new HashMap<>();
        private final Map<ResourceId, Set<String>> modelFaceTextureRefsCache = new HashMap<>();
        private final Map<ResourceId, Set<ResourceId>> modelResolvedTexturesCache = new HashMap<>();
        private final Map<String, Set<ResourceId>> blockStateModelsCache = new HashMap<>();
        private final Map<ResourceId, TextureExportInfo> exportCache = new HashMap<>();

        Set<ResourceId> resolveModelsForState(BlockStateRef state, Set<String> missingAssets) {
            String cacheKey = state.canonicalState();
            if (blockStateModelsCache.containsKey(cacheKey))
                return blockStateModelsCache.get(cacheKey);

            ResourceId blockId = new ResourceId(state.namespace(), state.path());

            Set<ResourceId> models = new LinkedHashSet<>();
            String resourcePath = blockStatePath(blockId);
            JsonObject blockstate = loadJsonObject(resourcePath, missingAssets);
            if (blockstate == null) {
                blockStateModelsCache.put(cacheKey, Set.of());
                return Set.of();
            }

            JsonObject variants = asObject(blockstate.get("variants"));
            if (variants != null)
                collectVariantModels(variants, state.properties(), blockId.namespace(), models);

            JsonArray multipart = asArray(blockstate.get("multipart"));
            if (multipart != null)
                collectMultipartModels(multipart, state.properties(), blockId.namespace(), models);

            Set<ResourceId> frozen = Collections.unmodifiableSet(new LinkedHashSet<>(models));
            blockStateModelsCache.put(cacheKey, frozen);
            return frozen;
        }

        Set<ResourceId> resolveTexturesForModels(Set<ResourceId> models, Set<String> missingAssets) {
            Set<ResourceId> out = new LinkedHashSet<>();
            for (ResourceId model : models)
                out.addAll(resolveTexturesForModel(model, missingAssets));
            return out;
        }

        TextureExportInfo exportTexture(ResourceId textureId, Path texturesRoot, Set<String> missingAssets) {
            TextureExportInfo cached = exportCache.get(textureId);
            if (cached != null)
                return cached;

            String sourcePath = texturePath(textureId);
            String uri = "textures/" + textureId.namespace() + "/" + textureId.path() + ".png";
            Path outPath = texturesRoot.resolve(textureId.namespace()).resolve(textureId.path() + ".png");
            Path outMetaPath = texturesRoot.resolve(textureId.namespace()).resolve(textureId.path() + ".png.mcmeta");
            Path normalizedRoot = texturesRoot.normalize();
            Path normalizedOutPath = outPath.normalize();
            Path normalizedOutMetaPath = outMetaPath.normalize();

            if (!normalizedOutPath.startsWith(normalizedRoot) || !normalizedOutMetaPath.startsWith(normalizedRoot)) {
                TextureExportInfo info = new TextureExportInfo(textureId, sourcePath, uri, false, false);
                exportCache.put(textureId, info);
                return info;
            }

            boolean exported = false;
            boolean hasMcmeta = false;

            try (InputStream texture = openResource(sourcePath)) {
                if (texture == null) {
                    missingAssets.add(sourcePath);
                    TextureExportInfo info = new TextureExportInfo(textureId, sourcePath, uri, false, false);
                    exportCache.put(textureId, info);
                    return info;
                }

                Files.createDirectories(normalizedOutPath.getParent());
                Files.copy(texture, normalizedOutPath, StandardCopyOption.REPLACE_EXISTING);
                exported = true;
            } catch (Exception e) {
                LittleTilesParityExporter.LOGGER.warn("lt-texture-export failed to copy texture {}: {}", sourcePath, e.getMessage());
                TextureExportInfo info = new TextureExportInfo(textureId, sourcePath, uri, false, false);
                exportCache.put(textureId, info);
                return info;
            }

            String metaSourcePath = sourcePath + ".mcmeta";
            try (InputStream meta = openResource(metaSourcePath)) {
                if (meta != null) {
                    Files.createDirectories(normalizedOutMetaPath.getParent());
                    Files.copy(meta, normalizedOutMetaPath, StandardCopyOption.REPLACE_EXISTING);
                    hasMcmeta = true;
                }
            } catch (Exception e) {
                LittleTilesParityExporter.LOGGER.warn("lt-texture-export failed to copy texture metadata {}: {}", metaSourcePath, e.getMessage());
            }

            TextureExportInfo info = new TextureExportInfo(textureId, sourcePath, uri, exported, hasMcmeta);
            exportCache.put(textureId, info);
            return info;
        }

        private Set<ResourceId> resolveTexturesForModel(ResourceId modelId, Set<String> missingAssets) {
            Set<ResourceId> cached = modelResolvedTexturesCache.get(modelId);
            if (cached != null)
                return cached;

            Map<String, String> mergedTextures = resolveModelTextures(modelId, missingAssets, new HashSet<>());
            Set<String> refs = new LinkedHashSet<>(mergedTextures.values());
            refs.addAll(resolveModelFaceTextureRefs(modelId, missingAssets, new HashSet<>()));

            Set<ResourceId> out = new LinkedHashSet<>();
            for (String ref : refs) {
                String resolved = resolveTextureRef(ref, mergedTextures, new HashSet<>());
                if (resolved == null || resolved.isBlank())
                    continue;
                out.add(ResourceId.parse(resolved, modelId.namespace()));
            }

            Set<ResourceId> frozen = Collections.unmodifiableSet(out);
            modelResolvedTexturesCache.put(modelId, frozen);
            return frozen;
        }

        private Map<String, String> resolveModelTextures(
                ResourceId modelId,
                Set<String> missingAssets,
                Set<ResourceId> visiting) {
            Map<String, String> cached = modelTexturesCache.get(modelId);
            if (cached != null)
                return cached;

            if (!visiting.add(modelId))
                return Map.of();

            String resourcePath = modelPath(modelId);
            JsonObject model = loadJsonObject(resourcePath, missingAssets);
            if (model == null) {
                visiting.remove(modelId);
                modelTexturesCache.put(modelId, Map.of());
                return Map.of();
            }

            Map<String, String> out = new LinkedHashMap<>();
            String parentRaw = asString(model.get("parent"));
            if (parentRaw != null && !parentRaw.startsWith("builtin/")) {
                ResourceId parent = ResourceId.parse(parentRaw, modelId.namespace());
                out.putAll(resolveModelTextures(parent, missingAssets, visiting));
            }

            JsonObject textures = asObject(model.get("textures"));
            if (textures != null) {
                for (Map.Entry<String, JsonElement> entry : textures.entrySet()) {
                    String key = entry.getKey();
                    String value = asString(entry.getValue());
                    if (key != null && value != null && !key.isBlank() && !value.isBlank())
                        out.put(key, value.trim());
                }
            }

            visiting.remove(modelId);
            Map<String, String> frozen = Collections.unmodifiableMap(new LinkedHashMap<>(out));
            modelTexturesCache.put(modelId, frozen);
            return frozen;
        }

        private Set<String> resolveModelFaceTextureRefs(
                ResourceId modelId,
                Set<String> missingAssets,
                Set<ResourceId> visiting) {
            Set<String> cached = modelFaceTextureRefsCache.get(modelId);
            if (cached != null)
                return cached;

            if (!visiting.add(modelId))
                return Set.of();

            String resourcePath = modelPath(modelId);
            JsonObject model = loadJsonObject(resourcePath, missingAssets);
            if (model == null) {
                visiting.remove(modelId);
                modelFaceTextureRefsCache.put(modelId, Set.of());
                return Set.of();
            }

            Set<String> out = new LinkedHashSet<>();
            JsonArray elements = asArray(model.get("elements"));
            if (elements != null) {
                for (JsonElement element : elements) {
                    JsonObject obj = asObject(element);
                    if (obj == null)
                        continue;
                    JsonObject faces = asObject(obj.get("faces"));
                    if (faces == null)
                        continue;
                    for (Map.Entry<String, JsonElement> faceEntry : faces.entrySet()) {
                        JsonObject faceObj = asObject(faceEntry.getValue());
                        if (faceObj == null)
                            continue;
                        String texture = asString(faceObj.get("texture"));
                        if (texture != null && !texture.isBlank())
                            out.add(texture.trim());
                    }
                }
            }

            String parentRaw = asString(model.get("parent"));
            if (parentRaw != null && !parentRaw.startsWith("builtin/")) {
                ResourceId parent = ResourceId.parse(parentRaw, modelId.namespace());
                out.addAll(resolveModelFaceTextureRefs(parent, missingAssets, visiting));
            }

            visiting.remove(modelId);
            Set<String> frozen = Collections.unmodifiableSet(new LinkedHashSet<>(out));
            modelFaceTextureRefsCache.put(modelId, frozen);
            return frozen;
        }

        private void collectVariantModels(
                JsonObject variants,
                Map<String, String> stateProps,
                String defaultNamespace,
                Set<ResourceId> out) {
            boolean matchedAny = false;
            for (Map.Entry<String, JsonElement> entry : variants.entrySet()) {
                String key = entry.getKey();
                if (key == null || key.isBlank())
                    continue;
                if (!variantMatchesState(key, stateProps))
                    continue;
                matchedAny = true;
                collectModelRefs(entry.getValue(), defaultNamespace, out);
            }

            if (!matchedAny && variants.has(""))
                collectModelRefs(variants.get(""), defaultNamespace, out);
        }

        private void collectMultipartModels(
                JsonArray multipart,
                Map<String, String> stateProps,
                String defaultNamespace,
                Set<ResourceId> out) {
            for (JsonElement partElement : multipart) {
                JsonObject part = asObject(partElement);
                if (part == null)
                    continue;

                JsonElement when = part.get("when");
                if (when != null && !whenMatchesState(when, stateProps))
                    continue;

                collectModelRefs(part.get("apply"), defaultNamespace, out);
            }
        }

        private JsonObject loadJsonObject(String resourcePath, Set<String> missingAssets) {
            if (jsonObjectCache.containsKey(resourcePath))
                return jsonObjectCache.get(resourcePath);
            if (jsonObjectMissing.contains(resourcePath)) {
                missingAssets.add(resourcePath);
                return null;
            }

            try (InputStream stream = openResource(resourcePath)) {
                if (stream == null) {
                    jsonObjectMissing.add(resourcePath);
                    missingAssets.add(resourcePath);
                    return null;
                }
                try (Reader reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
                    JsonElement parsed = JsonParser.parseReader(reader);
                    JsonObject object = asObject(parsed);
                    if (object == null) {
                        jsonObjectMissing.add(resourcePath);
                        missingAssets.add(resourcePath);
                        return null;
                    }
                    jsonObjectCache.put(resourcePath, object);
                    return object;
                }
            } catch (Exception e) {
                jsonObjectMissing.add(resourcePath);
                missingAssets.add(resourcePath);
                LittleTilesParityExporter.LOGGER.warn("lt-texture-export failed to parse JSON resource {}: {}", resourcePath, e.getMessage());
                return null;
            }
        }

        private InputStream openResource(String resourcePath) {
            String normalized = resourcePath.startsWith("/") ? resourcePath.substring(1) : resourcePath;
            InputStream stream = classLoader.getResourceAsStream(normalized);
            if (stream != null)
                return stream;
            ClassLoader contextLoader = Thread.currentThread().getContextClassLoader();
            if (contextLoader != null)
                return contextLoader.getResourceAsStream(normalized);
            return null;
        }
    }

    private static void collectModelRefs(JsonElement value, String defaultNamespace, Set<ResourceId> out) {
        if (value == null || value.isJsonNull())
            return;
        if (value.isJsonArray()) {
            for (JsonElement entry : value.getAsJsonArray())
                collectModelRefs(entry, defaultNamespace, out);
            return;
        }
        JsonObject object = asObject(value);
        if (object == null)
            return;
        String model = asString(object.get("model"));
        if (model == null || model.isBlank())
            return;
        out.add(ResourceId.parse(model, defaultNamespace));
    }

    private static boolean variantMatchesState(String variantKey, Map<String, String> stateProps) {
        if (variantKey == null || variantKey.isBlank())
            return true;
        String[] clauses = variantKey.split(",");
        for (String clauseRaw : clauses) {
            String clause = clauseRaw.trim();
            if (clause.isBlank())
                continue;
            int equals = clause.indexOf('=');
            if (equals <= 0 || equals >= clause.length() - 1)
                return false;
            String key = clause.substring(0, equals).trim();
            String expectedRaw = clause.substring(equals + 1).trim();
            String actual = stateProps.get(key);
            if (actual == null)
                return false;
            if (!propertyValueMatches(expectedRaw, actual))
                return false;
        }
        return true;
    }

    private static boolean whenMatchesState(JsonElement when, Map<String, String> stateProps) {
        if (when == null || when.isJsonNull())
            return true;

        JsonObject object = asObject(when);
        if (object == null)
            return false;

        JsonElement orElement = object.get("OR");
        if (orElement != null) {
            JsonArray array = asArray(orElement);
            if (array == null || array.size() == 0)
                return false;
            for (JsonElement element : array) {
                if (whenMatchesState(element, stateProps))
                    return true;
            }
            return false;
        }

        JsonElement andElement = object.get("AND");
        if (andElement != null) {
            JsonArray array = asArray(andElement);
            if (array == null || array.size() == 0)
                return false;
            for (JsonElement element : array) {
                if (!whenMatchesState(element, stateProps))
                    return false;
            }
            return true;
        }

        for (Map.Entry<String, JsonElement> entry : object.entrySet()) {
            String key = entry.getKey();
            if ("OR".equals(key) || "AND".equals(key))
                continue;
            String actual = stateProps.get(key);
            if (actual == null)
                return false;
            String expectedRaw = asString(entry.getValue());
            if (expectedRaw == null || !propertyValueMatches(expectedRaw, actual))
                return false;
        }
        return true;
    }

    private static boolean propertyValueMatches(String expectedRaw, String actual) {
        String[] options = expectedRaw.split("\\|");
        for (String option : options) {
            if (actual.equals(option.trim()))
                return true;
        }
        return false;
    }

    private static String resolveTextureRef(String value, Map<String, String> textureMap, Set<String> visiting) {
        if (value == null || value.isBlank())
            return null;
        String current = value.trim();
        while (current.startsWith("#")) {
            String key = current.substring(1);
            if (key.isBlank() || !visiting.add(key))
                return null;
            String mapped = textureMap.get(key);
            if (mapped == null || mapped.isBlank())
                return null;
            current = mapped.trim();
        }
        return current;
    }

    private static String blockStatePath(ResourceId blockId) {
        return "assets/" + blockId.namespace() + "/blockstates/" + blockId.path() + ".json";
    }

    private static String modelPath(ResourceId modelId) {
        return "assets/" + modelId.namespace() + "/models/" + modelId.path() + ".json";
    }

    private static String texturePath(ResourceId textureId) {
        return "assets/" + textureId.namespace() + "/textures/" + textureId.path() + ".png";
    }

    private static JsonObject asObject(JsonElement value) {
        return value != null && value.isJsonObject() ? value.getAsJsonObject() : null;
    }

    private static JsonArray asArray(JsonElement value) {
        return value != null && value.isJsonArray() ? value.getAsJsonArray() : null;
    }

    private static String asString(JsonElement value) {
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()
                ? value.getAsString()
                : null;
    }
}
