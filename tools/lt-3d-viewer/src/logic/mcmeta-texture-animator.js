const TICKS_PER_SECOND = 20;

class McmetaTextureAnimator {
    constructor(context) {
        this.context = context;
        this.bindings = [];
        this.hasInterpolatedAnimations = false;
    }

    reset() {
        this.bindings = [];
        this.hasInterpolatedAnimations = false;
    }

    hasActiveAnimations() {
        return this.bindings.length > 0;
    }

    needsContinuousRedraw(state) {
        if (!this.hasInterpolatedAnimations) {
            return false;
        }
        if (state?.animationTimer?.paused === true) {
            return false;
        }
        return true;
    }

    async attach(gltf, additionalFiles = []) {
        this.reset();

        if (!gltf || typeof document === "undefined") {
            return;
        }

        const fileIndex = buildAdditionalFileIndex(additionalFiles);
        const nextBindings = [];

        for (let textureIndex = 0; textureIndex < (gltf.textures?.length ?? 0); textureIndex++) {
            const texture = gltf.textures[textureIndex];
            if (!texture || texture.type !== this.context.TEXTURE_2D) {
                continue;
            }

            if (!Number.isInteger(texture.source)) {
                continue;
            }

            const image = gltf.images?.[texture.source];
            const imageDimensions = getImageDimensions(image?.image);
            if (!image || !imageDimensions) {
                continue;
            }

            if (!isByteAddressableImage(image.mimeType)) {
                continue;
            }

            const metadata = await resolveTextureMetadata(
                texture,
                image,
                imageDimensions,
                fileIndex
            );
            if (!metadata) {
                continue;
            }

            if (metadata.emissive) {
                applyEmissiveOverrides(gltf, textureIndex, metadata.emissive);
            }

            const animation = metadata.animation;
            if (!animation) {
                continue;
            }

            const canvas = document.createElement("canvas");
            canvas.width = animation.frameWidth;
            canvas.height = animation.frameHeight;
            const canvas2d = canvas.getContext("2d", { alpha: true, desynchronized: true });
            if (!canvas2d) {
                continue;
            }
            canvas2d.imageSmoothingEnabled = false;

            const sampler = Number.isInteger(texture.sampler) ? gltf.samplers?.[texture.sampler] : undefined;
            const generateMips = usesMipmaps(sampler, this.context);

            nextBindings.push({
                texture,
                sourceImage: image.image,
                animation,
                canvas,
                canvas2d,
                generateMips,
                linearTextureDefined: false,
                srgbTextureDefined: false,
                lastSampleKey: null,
            });
        }

        this.bindings = nextBindings;
        this.hasInterpolatedAnimations = this.bindings.some((entry) => entry.animation.interpolate === true);
    }

    update(state) {
        if (!state?.gltf || this.bindings.length === 0) {
            return false;
        }

        if (state.animationTimer?.paused === true) {
            return false;
        }

        const elapsedSec = Number(state.animationTimer?.elapsedSec?.() ?? 0);
        if (!Number.isFinite(elapsedSec)) {
            return false;
        }

        let uploadedAny = false;

        for (const binding of this.bindings) {
            const sample = sampleFrame(binding.animation, elapsedSec);
            if (!sample) {
                continue;
            }

            const sampleKey = `${sample.frameIndex}|${sample.nextFrameIndex}|${sample.blend.toFixed(6)}`;
            if (sampleKey === binding.lastSampleKey) {
                continue;
            }

            drawSample(binding, sample);
            if (uploadSample(this.context, binding)) {
                binding.lastSampleKey = sampleKey;
                uploadedAny = true;
            }
        }

        return uploadedAny;
    }
}

async function resolveTextureMetadata(texture, image, imageDimensions, additionalFileIndex) {
    let animation = null;
    let emissive = null;

    const inlineCandidates = [
        texture?.extras?.minecraftAnimation,
        texture?.extras?.animation,
        texture?.extras?.minecraftAnimation?.animation,
        image?.extras?.minecraftAnimation,
        image?.extras?.animation,
        image?.extras?.minecraftAnimation?.animation,
    ];

    for (const candidate of inlineCandidates) {
        const normalizedAnimation = normalizeAnimationMetadata(candidate, imageDimensions);
        if (normalizedAnimation) {
            animation = normalizedAnimation;
            break;
        }
    }

    const mcmetaCandidates = collectMcmetaUriCandidates(texture, image);
    for (const candidate of mcmetaCandidates) {
        const text = await loadMcmetaText(candidate, image?.uri, additionalFileIndex);
        if (!text) {
            continue;
        }

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            continue;
        }

        const normalized = normalizeMcmetaMetadata(parsed, imageDimensions, image?.image);
        if (!normalized) {
            continue;
        }

        if (!animation && normalized.animation) {
            animation = normalized.animation;
        }

        if (!emissive && normalized.emissive) {
            emissive = normalized.emissive;
        }

        if (animation && emissive) {
            break;
        }
    }

    if (!animation && !emissive) {
        return null;
    }

    return {
        animation,
        emissive,
    };
}

function collectMcmetaUriCandidates(texture, image) {
    const out = [];
    const push = (value) => {
        const uri = String(value ?? "").trim();
        if (!uri || out.includes(uri)) {
            return;
        }
        out.push(uri);
    };

    push(texture?.extras?.mcmetaUri);
    push(texture?.extras?.minecraftAnimation?.mcmetaUri);
    push(image?.extras?.mcmetaUri);
    push(image?.extras?.minecraftAnimation?.mcmetaUri);

    const imageUri = String(image?.uri ?? "").trim();
    if (imageUri && !imageUri.startsWith("data:")) {
        push(`${imageUri}.mcmeta`);
    }

    return out;
}

async function loadMcmetaText(candidateUri, imageUri, additionalFileIndex) {
    const resolvedUri = resolveResourceUri(candidateUri, imageUri);

    const additionalFile = findAdditionalFile(additionalFileIndex, resolvedUri);
    if (additionalFile) {
        try {
            return await additionalFile.text();
        } catch {
            return null;
        }
    }

    if (typeof fetch !== "function") {
        return null;
    }

    try {
        const response = await fetch(resolvedUri, { cache: "no-store" });
        if (!response.ok) {
            return null;
        }
        return await response.text();
    } catch {
        return null;
    }
}

function buildAdditionalFileIndex(additionalFiles) {
    const out = new Map();
    if (!Array.isArray(additionalFiles)) {
        return out;
    }

    for (const entry of additionalFiles) {
        const filePath = normalizeFilePath(entry?.[0]);
        const file = entry?.[1];
        if (!filePath || !file) {
            continue;
        }
        out.set(filePath, file);
    }

    return out;
}

function findAdditionalFile(fileIndex, uri) {
    if (!(fileIndex instanceof Map) || fileIndex.size === 0) {
        return null;
    }

    const normalizedUri = normalizeFilePath(uri);
    if (!normalizedUri) {
        return null;
    }

    if (fileIndex.has(normalizedUri)) {
        return fileIndex.get(normalizedUri);
    }

    for (const [path, file] of fileIndex.entries()) {
        if (path.endsWith(normalizedUri)) {
            return file;
        }
    }

    return null;
}

function normalizeFilePath(value) {
    let path = String(value ?? "").trim();
    if (!path) {
        return null;
    }

    path = path.replaceAll("\\", "/");

    if (isAbsoluteHttpUrl(path)) {
        try {
            path = new URL(path).pathname;
        } catch {
            return null;
        }
    }

    if (path.startsWith("./")) {
        path = path.slice(2);
    }

    if (!path.startsWith("/")) {
        path = `/${path}`;
    }

    return path;
}

function resolveResourceUri(candidateUri, imageUri) {
    const candidate = String(candidateUri ?? "").trim();
    if (!candidate) {
        return "";
    }

    if (isAbsoluteHttpUrl(candidate) || candidate.startsWith("data:") || candidate.startsWith("blob:")) {
        return candidate;
    }

    const base = String(imageUri ?? "").trim();
    if (base && isAbsoluteHttpUrl(base)) {
        try {
            return new URL(candidate, base).toString();
        } catch {
            return candidate;
        }
    }

    return candidate;
}

function normalizeMcmetaMetadata(rawMcmeta, imageDimensions, sourceImage) {
    if (!rawMcmeta || typeof rawMcmeta !== "object") {
        return null;
    }

    const animation = normalizeAnimationMetadata(rawMcmeta.animation, imageDimensions);
    const emissive = normalizeEmissiveMetadata(rawMcmeta, imageDimensions, sourceImage);
    if (!animation && !emissive) {
        return null;
    }

    return {
        animation,
        emissive,
    };
}

function normalizeAnimationMetadata(rawAnimation, imageDimensions) {
    if (!rawAnimation || typeof rawAnimation !== "object") {
        return null;
    }
    if (!hasExplicitAnimationPayload(rawAnimation)) {
        return null;
    }

    const frameWidth = imageDimensions.width;
    const imageHeight = imageDimensions.height;

    const frameHeight = normalizePositiveInt(rawAnimation.frameHeight ?? rawAnimation.height, frameWidth);
    if (!Number.isInteger(frameHeight) || frameHeight <= 0) {
        return null;
    }

    let frameCount = normalizePositiveInt(rawAnimation.frameCount, null);
    if (!Number.isInteger(frameCount) || frameCount <= 0) {
        frameCount = Math.floor(imageHeight / frameHeight);
    }
    if (!Number.isInteger(frameCount) || frameCount <= 1) {
        return null;
    }

    const frameTime = normalizePositiveInt(rawAnimation.frameTime ?? rawAnimation.frametime, 1);
    const frames = normalizeAnimationFrames(rawAnimation.frames, frameCount, frameTime);
    const periodTicks = frames.reduce((sum, frame) => sum + frame.time, 0);
    if (!Number.isFinite(periodTicks) || periodTicks <= 0) {
        return null;
    }

    return {
        frameWidth,
        frameHeight,
        frameCount,
        frameTime,
        frames,
        periodTicks,
        interpolate: rawAnimation.interpolate === true,
    };
}

function hasExplicitAnimationPayload(rawAnimation) {
    return (
        rawAnimation.frames !== undefined ||
        rawAnimation.frameTime !== undefined ||
        rawAnimation.frametime !== undefined ||
        rawAnimation.frameCount !== undefined ||
        rawAnimation.frameHeight !== undefined ||
        rawAnimation.height !== undefined ||
        rawAnimation.interpolate !== undefined
    );
}

function normalizeEmissiveMetadata(rawMcmeta, imageDimensions, sourceImage) {
    const fusion = rawMcmeta?.fusion;
    const hasEmissiveFlag = fusion?.emissive === true || rawMcmeta?.emissive === true;
    if (!hasEmissiveFlag) {
        return null;
    }

    const strength = normalizePositiveNumber(
        fusion?.emissiveStrength ?? rawMcmeta?.emissiveStrength,
        1
    );
    const explicitColor =
        normalizeColorFactor(fusion?.emissiveColor) ??
        normalizeColorFactor(fusion?.color) ??
        normalizeColorFactor(rawMcmeta?.emissiveColor) ??
        normalizeColorFactor(rawMcmeta?.color);

    const sampledColor = explicitColor
        ? null
        : sampleDominantColorFromTopFrame(sourceImage, imageDimensions);
    const colorFactor = explicitColor ?? sampledColor ?? [1, 1, 1];

    return {
        strength,
        colorFactor,
    };
}

function applyEmissiveOverrides(gltf, textureIndex, emissiveMetadata) {
    const materials = Array.isArray(gltf?.materials) ? gltf.materials : [];
    for (const material of materials) {
        const baseColorTexture = material?.pbrMetallicRoughness?.baseColorTexture;
        if (!baseColorTexture || baseColorTexture.index !== textureIndex) {
            continue;
        }

        const emissiveTexture = cloneTextureInfo(baseColorTexture);
        emissiveTexture.linear = false;
        emissiveTexture.samplerName = "u_EmissiveSampler";

        material.emissiveTexture = emissiveTexture;
        material.emissiveFactor = normalizeColorFactor(emissiveMetadata.colorFactor) ?? [1, 1, 1];
        material.extensions ??= {};
        material.extensions.KHR_materials_emissive_strength = {
            emissiveStrength: normalizePositiveNumber(emissiveMetadata.strength, 1),
        };
        material.hasEmissiveStrength = true;

        material.textures = Array.isArray(material.textures)
            ? material.textures.filter((info) => info?.samplerName !== "u_EmissiveSampler")
            : [];
        material.textures.push(emissiveTexture);

        material.defines = Array.isArray(material.defines) ? material.defines : [];
        if (!material.defines.includes("HAS_EMISSIVE_MAP 1")) {
            material.defines.push("HAS_EMISSIVE_MAP 1");
        }

        const uvTransform = baseColorTexture?.extensions?.KHR_texture_transform;
        if (uvTransform && typeof material.parseTextureInfoExtensions === "function") {
            emissiveTexture.extensions ??= {};
            emissiveTexture.extensions.KHR_texture_transform = uvTransform;
            material.parseTextureInfoExtensions(emissiveTexture, "Emissive");
        }
    }
}

function cloneTextureInfo(textureInfo) {
    const out = Object.create(Object.getPrototypeOf(textureInfo));
    return Object.assign(out, textureInfo);
}

function sampleDominantColorFromTopFrame(sourceImage, imageDimensions) {
    if (!sourceImage || typeof document === "undefined") {
        return null;
    }

    const frameWidth = Math.max(1, Math.floor(Number(imageDimensions?.width ?? 0)));
    const frameHeight = Math.max(1, Math.floor(Number(imageDimensions?.width ?? 0)));
    if (frameWidth <= 0 || frameHeight <= 0) {
        return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    const canvas2d = canvas.getContext("2d", { alpha: true });
    if (!canvas2d) {
        return null;
    }

    canvas2d.drawImage(
        sourceImage,
        0,
        0,
        frameWidth,
        frameHeight,
        0,
        0,
        frameWidth,
        frameHeight
    );

    const imageData = canvas2d.getImageData(0, 0, frameWidth, frameHeight);
    const data = imageData.data;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
        const alpha = data[i + 3] / 255;
        if (alpha <= 0) {
            continue;
        }
        sumR += (data[i] / 255) * alpha;
        sumG += (data[i + 1] / 255) * alpha;
        sumB += (data[i + 2] / 255) * alpha;
        sumA += alpha;
    }

    if (sumA <= 0) {
        return null;
    }

    const avgR = sumR / sumA;
    const avgG = sumG / sumA;
    const avgB = sumB / sumA;
    if (Math.max(avgR, avgG, avgB) <= 0.0001) {
        return [1, 1, 1];
    }

    return [
        clamp01(avgR),
        clamp01(avgG),
        clamp01(avgB),
    ];
}

function normalizeColorFactor(value) {
    if (Array.isArray(value) && value.length >= 3) {
        const raw = [Number(value[0]), Number(value[1]), Number(value[2])];
        if (raw.every((entry) => Number.isFinite(entry))) {
            const maxValue = Math.max(raw[0], raw[1], raw[2]);
            if (maxValue > 1) {
                return [clamp01(raw[0] / 255), clamp01(raw[1] / 255), clamp01(raw[2] / 255)];
            }
            return [clamp01(raw[0]), clamp01(raw[1]), clamp01(raw[2])];
        }
    }

    if (Number.isInteger(value)) {
        const color = value & 0xffffff;
        return [
            ((color >>> 16) & 255) / 255,
            ((color >>> 8) & 255) / 255,
            (color & 255) / 255,
        ];
    }

    const raw = String(value ?? "").trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(raw)) {
        const normalized = raw.startsWith("#") ? raw.slice(1) : raw;
        const parsed = Number.parseInt(normalized, 16);
        if (Number.isInteger(parsed)) {
            return [
                ((parsed >>> 16) & 255) / 255,
                ((parsed >>> 8) & 255) / 255,
                (parsed & 255) / 255,
            ];
        }
    }

    return null;
}

function normalizeAnimationFrames(framesRaw, frameCount, defaultFrameTime) {
    const out = [];

    if (Array.isArray(framesRaw)) {
        for (const entry of framesRaw) {
            if (Number.isInteger(entry)) {
                out.push({
                    index: clampFrameIndex(entry, frameCount),
                    time: defaultFrameTime,
                });
                continue;
            }

            if (!entry || typeof entry !== "object") {
                continue;
            }

            const index = Number(entry.index);
            if (!Number.isInteger(index)) {
                continue;
            }

            out.push({
                index: clampFrameIndex(index, frameCount),
                time: normalizePositiveInt(entry.time, defaultFrameTime),
            });
        }
    }

    if (out.length > 0) {
        return out;
    }

    for (let i = 0; i < frameCount; i++) {
        out.push({
            index: i,
            time: defaultFrameTime,
        });
    }

    return out;
}

function sampleFrame(animation, elapsedSec) {
    if (!animation || !Array.isArray(animation.frames) || animation.frames.length === 0) {
        return null;
    }

    const totalTicks = animation.periodTicks;
    if (!Number.isFinite(totalTicks) || totalTicks <= 0) {
        return null;
    }

    // Minecraft animated textures advance on client ticks (20 TPS).
    const ticks = Math.floor(mod(elapsedSec * TICKS_PER_SECOND, totalTicks));

    let cursor = 0;
    for (let i = 0; i < animation.frames.length; i++) {
        const frame = animation.frames[i];
        const duration = Math.max(1, frame.time);

        if (ticks < cursor + duration || i === animation.frames.length - 1) {
            const localTick = ticks - cursor;
            const nextFrame = animation.frames[(i + 1) % animation.frames.length];
            const blend =
                animation.interpolate === true && duration > 1
                    ? clamp01(localTick / duration)
                    : 0;
            return {
                frameIndex: frame.index,
                nextFrameIndex: nextFrame.index,
                blend,
            };
        }

        cursor += duration;
    }

    return null;
}

function drawSample(binding, sample) {
    const { canvas2d, canvas, sourceImage, animation } = binding;

    canvas2d.setTransform(1, 0, 0, 1, 0, 0);
    canvas2d.clearRect(0, 0, canvas.width, canvas.height);
    canvas2d.globalAlpha = 1;

    drawFrame(canvas2d, sourceImage, animation, sample.frameIndex, 1);

    if (sample.blend > 0) {
        drawFrame(canvas2d, sourceImage, animation, sample.nextFrameIndex, sample.blend);
    }

    canvas2d.globalAlpha = 1;
}

function drawFrame(canvas2d, sourceImage, animation, frameIndex, alpha) {
    const sourceY = frameIndex * animation.frameHeight;
    canvas2d.globalAlpha = alpha;
    canvas2d.drawImage(
        sourceImage,
        0,
        sourceY,
        animation.frameWidth,
        animation.frameHeight,
        0,
        0,
        animation.frameWidth,
        animation.frameHeight
    );
}

function uploadSample(context, binding) {
    const texture = binding.texture;

    let uploaded = false;

    if (texture.initialized === true && texture.glTexture) {
        const linearFirstUpload = binding.linearTextureDefined !== true;
        const linearUploaded = uploadToTextureHandle(
            context,
            texture.type,
            texture.glTexture,
            binding,
            linearFirstUpload,
            false
        );
        uploaded |= linearUploaded;
        if (linearUploaded) {
            binding.linearTextureDefined = true;
        }
    }

    if (texture.initializedSRGB === true && texture.glTextureSRGB) {
        const srgbFirstUpload = binding.srgbTextureDefined !== true;
        const srgbUploaded = uploadToTextureHandle(
            context,
            texture.type,
            texture.glTextureSRGB,
            binding,
            srgbFirstUpload,
            true
        );
        uploaded |= srgbUploaded;
        if (srgbUploaded) {
            binding.srgbTextureDefined = true;
        }
    }

    return uploaded;
}

function uploadToTextureHandle(context, textureType, glTexture, binding, firstUpload, useSrgbInternalFormat) {
    context.bindTexture(textureType, glTexture);
    context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
    if (firstUpload === true) {
        const internalFormat =
            useSrgbInternalFormat === true && context.SRGB8_ALPHA8 !== undefined
                ? context.SRGB8_ALPHA8
                : context.RGBA;
        // Redefine storage to a single frame so UV 0..1 maps to one square frame.
        context.texImage2D(
            textureType,
            0,
            internalFormat,
            context.RGBA,
            context.UNSIGNED_BYTE,
            binding.canvas
        );
    } else {
        context.texSubImage2D(
            textureType,
            0,
            0,
            0,
            context.RGBA,
            context.UNSIGNED_BYTE,
            binding.canvas
        );
    }

    if (binding.generateMips) {
        context.generateMipmap(textureType);
    }

    return true;
}

function usesMipmaps(sampler, context) {
    const minFilter = sampler?.minFilter;
    return (
        minFilter === context.NEAREST_MIPMAP_NEAREST ||
        minFilter === context.NEAREST_MIPMAP_LINEAR ||
        minFilter === context.LINEAR_MIPMAP_NEAREST ||
        minFilter === context.LINEAR_MIPMAP_LINEAR
    );
}

function isByteAddressableImage(mimeType) {
    return mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp";
}

function getImageDimensions(image) {
    const width = Number(image?.naturalWidth ?? image?.width ?? image?.videoWidth ?? 0);
    const height = Number(image?.naturalHeight ?? image?.height ?? image?.videoHeight ?? 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }
    return {
        width: Math.floor(width),
        height: Math.floor(height),
    };
}

function normalizePositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function normalizePositiveNumber(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function clampFrameIndex(index, frameCount) {
    if (!Number.isInteger(index) || frameCount <= 0) {
        return 0;
    }
    if (index < 0) {
        return 0;
    }
    if (index >= frameCount) {
        return frameCount - 1;
    }
    return index;
}

function clamp01(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value <= 0) {
        return 0;
    }
    if (value >= 1) {
        return 1;
    }
    return value;
}

function mod(value, divisor) {
    if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor <= 0) {
        return 0;
    }
    return ((value % divisor) + divisor) % divisor;
}

function isAbsoluteHttpUrl(value) {
    return /^https?:\/\//i.test(String(value ?? ""));
}

export { McmetaTextureAnimator };
