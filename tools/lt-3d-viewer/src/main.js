import { GltfView } from "@khronosgroup/gltf-viewer";

import { UIModel } from "./logic/uimodel.js";
import { app } from "./ui/ui.js";
import { EMPTY, from, merge } from "rxjs";
import { mergeMap, map, share, catchError } from "rxjs/operators";
import { GltfModelPathProvider, fillEnvironmentWithPaths } from "./model_path_provider.js";

import { validateBytes } from "gltf-validator";
import { McmetaTextureAnimator } from "./logic/mcmeta-texture-animator.js";
import { mat4, vec3, vec4 } from "gl-matrix";

const SHOW_CARDINAL_OVERLAY = true;

export default async () => {
    const canvas = document.getElementById("canvas");
    const context = canvas.getContext("webgl2", {
        alpha: false,
        antialias: true
    });
    const cardinalOverlay = SHOW_CARDINAL_OVERLAY ? createCardinalOverlay(canvas) : null;
    const view = new GltfView(context);
    const resourceLoader = view.createResourceLoader();
    const state = view.createState();
    const mcmetaTextureAnimator = new McmetaTextureAnimator(context);
    state.renderingParameters.useDirectionalLightsWithDisabledIBL = true;

    const pathProvider = new GltfModelPathProvider(
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main"
    );
    await pathProvider.initialize();
    const environmentPaths = fillEnvironmentWithPaths(
        {
            Cannon_Exterior: "Cannon Exterior",
            footprint_court: "Footprint Court",
            pisa: "Pisa",
            doge2: "Doge's palace",
            ennis: "Dining room",
            field: "Field",
            helipad: "Helipad Goldenhour",
            papermill: "Papermill Ruins",
            neutral: "Studio Neutral",
            Colorful_Studio: "Colorful Studio",
            Wide_Street: "Wide Street"
        },
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Environments/low_resolution_hdrs/"
    );

    const uiModel = new UIModel(app, pathProvider, environmentPaths);

    const validation = uiModel.model.pipe(
        mergeMap((model) => {
            const func = async (model) => {
                try {
                    const fileType = typeof model.mainFile;
                    if (fileType == "string") {
                        const externalRefFunction = (uri) => {
                            const parent = model.mainFile.substring(
                                0,
                                model.mainFile.lastIndexOf("/") + 1
                            );
                            return new Promise((resolve, reject) => {
                                fetch(parent + uri)
                                    .then((response) => {
                                        response
                                            .arrayBuffer()
                                            .then((buffer) => {
                                                resolve(new Uint8Array(buffer));
                                            })
                                            .catch((error) => {
                                                reject(error);
                                            });
                                    })
                                    .catch((error) => {
                                        reject(error);
                                    });
                            });
                        };
                        const response = await fetch(model.mainFile);
                        const buffer = await response.arrayBuffer();
                        return await validateBytes(new Uint8Array(buffer), {
                            externalResourceFunction: externalRefFunction,
                            uri: model.mainFile
                        });
                    } else if (Array.isArray(model.mainFile)) {
                        const externalRefFunction = (uri) => {
                            uri = "/" + uri;
                            return new Promise((resolve, reject) => {
                                let foundFile = undefined;
                                for (let i = 0; i < model.additionalFiles.length; i++) {
                                    const file = model.additionalFiles[i];
                                    if (file[0] == uri) {
                                        foundFile = file[1];
                                        break;
                                    }
                                }
                                if (foundFile) {
                                    foundFile
                                        .arrayBuffer()
                                        .then((buffer) => {
                                            resolve(new Uint8Array(buffer));
                                        })
                                        .catch((error) => {
                                            reject(error);
                                        });
                                } else {
                                    reject("File not found");
                                }
                            });
                        };

                        const buffer = await model.mainFile[1].arrayBuffer();
                        return await validateBytes(new Uint8Array(buffer), {
                            externalResourceFunction: externalRefFunction,
                            uri: model.mainFile[0]
                        });
                    }
                } catch (error) {
                    console.error(error);
                }
            };
            return from(func(model)).pipe(
                catchError((error) => {
                    console.error(`Validation failed: ${error}`);
                    return { error: `Validation failed: ${error}` };
                })
            );
        })
    );

    // whenever a new model is selected, load it and when complete pass the loaded gltf
    // into a stream back into the UI
    const gltfLoaded = uiModel.model.pipe(
        mergeMap((model) => {
            uiModel.goToLoadingState();

            // Workaround for errors in ktx lib after loading an asset with ktx2 files for the second time:
            resourceLoader.initKtxLib();

            return from(
                resourceLoader
                    .loadGltf(model.mainFile, model.additionalFiles)
                    .then(async (gltf) => {
                        state.gltf = gltf;
                        const defaultScene = state.gltf.scene;
                        state.sceneIndex = defaultScene === undefined ? 0 : defaultScene;
                        state.cameraNodeIndex = undefined;

                        if (state.gltf.scenes.length != 0) {
                            if (state.sceneIndex > state.gltf.scenes.length - 1) {
                                state.sceneIndex = 0;
                            }
                            const scene = state.gltf.scenes[state.sceneIndex];
                            scene.applyTransformHierarchy(state.gltf);
                            state.userCamera.perspective.aspectRatio = canvas.width / canvas.height;
                            state.userCamera.resetView(state.gltf, state.sceneIndex);

                            const queryString = window.location.search;
                            const urlParams = new URLSearchParams(queryString);
                            let yaw = urlParams.get("yaw") ?? 0;
                            yaw = (yaw * (Math.PI / 180)) / state.userCamera.orbitSpeed;
                            let pitch = urlParams.get("pitch") ?? 0;
                            pitch = (pitch * (Math.PI / 180)) / state.userCamera.orbitSpeed;
                            const distance = urlParams.get("distance") ?? 0;
                            state.userCamera.orbit(yaw, pitch);
                            state.userCamera.zoomBy(distance);

                            // Try to start as many animations as possible without generating conficts.
                            state.animationIndices = [];
                            for (let i = 0; i < gltf.animations.length; i++) {
                                if (
                                    !gltf.nonDisjointAnimations(state.animationIndices).includes(i)
                                ) {
                                    state.animationIndices.push(i);
                                }
                            }
                            state.animationTimer.start();
                        }

                        await mcmetaTextureAnimator.attach(gltf, model.additionalFiles);

                        uiModel.exitLoadingState();

                        return state;
                    })
                    .catch((error) => {
                        console.error("Loading failed: " + error);
                        resourceLoader.loadGltf(undefined, undefined).then((gltf) => {
                            state.gltf = gltf;
                            mcmetaTextureAnimator.reset();
                            state.sceneIndex = 0;
                            state.cameraNodeIndex = undefined;

                            uiModel.exitLoadingState();
                            redraw = true;
                        });
                        return state;
                    })
            );
        }),
        catchError((error) => {
            console.error(error);
            uiModel.exitLoadingState();
            return EMPTY;
        }),
        share()
    );

    // Disable all animations which are not disjoint to the current selection of animations.
    uiModel.disabledAnimations(
        uiModel.activeAnimations.pipe(
            map((animationIndices) => state.gltf.nonDisjointAnimations(animationIndices))
        )
    );

    const sceneChangedObservable = uiModel.scene.pipe(
        map((sceneIndex) => {
            state.sceneIndex = sceneIndex;
            state.cameraNodeIndex = undefined;
            const scene = state.gltf.scenes[state.sceneIndex];
            if (scene !== undefined) {
                scene.applyTransformHierarchy(state.gltf);
                state.userCamera.resetView(state.gltf, state.sceneIndex);
            }
        }),
        share()
    );

    const statisticsUpdateObservable = merge(sceneChangedObservable, gltfLoaded).pipe(
        map(() => view.gatherStatistics(state))
    );

    const cameraExportChangedObservable = uiModel.cameraValuesExport.pipe(
        map(() => {
            const camera =
                state.cameraNodeIndex === undefined
                    ? state.userCamera
                    : state.gltf.cameras[state.cameraNodeIndex];
            return camera.getDescription(state.gltf);
        })
    );

    const downloadDataURL = (filename, dataURL) => {
        const element = document.createElement("a");
        element.setAttribute("href", dataURL);
        element.setAttribute("download", filename);
        element.style.display = "none";
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    };

    cameraExportChangedObservable.subscribe((cameraDesc) => {
        const gltf = JSON.stringify(cameraDesc, undefined, 4);
        const dataURL = "data:text/plain;charset=utf-8," + encodeURIComponent(gltf);
        downloadDataURL("camera.gltf", dataURL);
    });

    uiModel.captureCanvas.subscribe(() => {
        view.renderFrame(state, canvas.width, canvas.height);
        const dataURL = canvas.toDataURL();
        downloadDataURL("capture.png", dataURL);
    });

    // Only redraw glTF view upon user inputs, or when an animation is playing.
    let redraw = false;
    const listenForRedraw = (stream) => stream.subscribe(() => (redraw = true));

    uiModel.scene.subscribe((scene) => (state.sceneIndex = scene !== -1 ? scene : undefined));
    listenForRedraw(uiModel.scene);

    uiModel.camera.subscribe(
        (camera) => (state.cameraNodeIndex = camera !== -1 ? camera : undefined)
    );
    listenForRedraw(uiModel.camera);

    uiModel.variant.subscribe((variant) => (state.variant = variant));
    listenForRedraw(uiModel.variant);

    uiModel.tonemap.subscribe((tonemap) => (state.renderingParameters.toneMap = tonemap));
    listenForRedraw(uiModel.tonemap);

    uiModel.debugchannel.subscribe(
        (debugchannel) => (state.renderingParameters.debugOutput = debugchannel)
    );
    listenForRedraw(uiModel.debugchannel);

    uiModel.skinningEnabled.subscribe(
        (skinningEnabled) => (state.renderingParameters.skinning = skinningEnabled)
    );
    listenForRedraw(uiModel.skinningEnabled);

    uiModel.exposure.subscribe(
        (exposure) => (state.renderingParameters.exposure = 1.0 / Math.pow(2.0, exposure))
    );
    listenForRedraw(uiModel.exposure);

    uiModel.morphingEnabled.subscribe(
        (morphingEnabled) => (state.renderingParameters.morphing = morphingEnabled)
    );
    listenForRedraw(uiModel.morphingEnabled);

    uiModel.clearcoatEnabled.subscribe(
        (clearcoatEnabled) =>
            (state.renderingParameters.enabledExtensions.KHR_materials_clearcoat = clearcoatEnabled)
    );
    listenForRedraw(uiModel.clearcoatEnabled);

    uiModel.sheenEnabled.subscribe(
        (sheenEnabled) =>
            (state.renderingParameters.enabledExtensions.KHR_materials_sheen = sheenEnabled)
    );
    listenForRedraw(uiModel.sheenEnabled);

    uiModel.transmissionEnabled.subscribe(
        (transmissionEnabled) =>
            (state.renderingParameters.enabledExtensions.KHR_materials_transmission =
                transmissionEnabled)
    );
    listenForRedraw(uiModel.transmissionEnabled);

    uiModel.diffuseTransmissionEnabled.subscribe(
        (diffuseTransmissionEnabled) =>
            (state.renderingParameters.enabledExtensions.KHR_materials_diffuse_transmission =
                diffuseTransmissionEnabled)
    );
    listenForRedraw(uiModel.diffuseTransmissionEnabled);

    uiModel.volumeEnabled.subscribe(
        (volumeEnabled) =>
            (state.renderingParameters.enabledExtensions.KHR_materials_volume = volumeEnabled)
    );
    listenForRedraw(uiModel.volumeEnabled);

    uiModel.iorEnabled.subscribe(
        (iorEnabled) => (state.renderingParameters.enabledExtensions.KHR_materials_ior = iorEnabled)
    );
    listenForRedraw(uiModel.iorEnabled);

    uiModel.iridescenceEnabled.subscribe(
        (iridescenceEnabled) =>
            (state.renderingParameters.enabledExtensions.KHR_materials_iridescence =
                iridescenceEnabled)
    );
    listenForRedraw(uiModel.iridescenceEnabled);

    uiModel.anisotropyEnabled.subscribe(
        (anisotropyEnabled) =>
            (state.renderingParameters.enabledExtensions.KHR_materials_anisotropy =
                anisotropyEnabled)
    );
    listenForRedraw(uiModel.anisotropyEnabled);

    uiModel.dispersionEnabled.subscribe(
        (dispersionEnabled) =>
            (state.renderingParameters.enabledExtensions.KHR_materials_dispersion =
                dispersionEnabled)
    );
    listenForRedraw(uiModel.dispersionEnabled);

    uiModel.specularEnabled.subscribe(
        (specularEnabled) =>
            (state.renderingParameters.enabledExtensions.KHR_materials_specular = specularEnabled)
    );
    listenForRedraw(uiModel.specularEnabled);

    uiModel.emissiveStrengthEnabled.subscribe(
        (enabled) =>
            (state.renderingParameters.enabledExtensions.KHR_materials_emissive_strength = enabled)
    );
    listenForRedraw(uiModel.emissiveStrengthEnabled);

    uiModel.volumeScatteringEnabled.subscribe(
        (enabled) =>
            (state.renderingParameters.enabledExtensions.KHR_materials_volume_scatter = enabled)
    );
    listenForRedraw(uiModel.volumeScatteringEnabled);

    uiModel.iblEnabled.subscribe((iblEnabled) => (state.renderingParameters.useIBL = iblEnabled));
    listenForRedraw(uiModel.iblEnabled);

    uiModel.iblIntensity.subscribe(
        (iblIntensity) => (state.renderingParameters.iblIntensity = Math.pow(10, iblIntensity))
    );
    listenForRedraw(uiModel.iblIntensity);

    uiModel.renderEnvEnabled.subscribe(
        (renderEnvEnabled) => (state.renderingParameters.renderEnvironmentMap = renderEnvEnabled)
    );
    listenForRedraw(uiModel.renderEnvEnabled);

    uiModel.blurEnvEnabled.subscribe(
        (blurEnvEnabled) => (state.renderingParameters.blurEnvironmentMap = blurEnvEnabled)
    );
    listenForRedraw(uiModel.blurEnvEnabled);

    uiModel.punctualLightsEnabled.subscribe(
        (punctualLightsEnabled) => (state.renderingParameters.usePunctual = punctualLightsEnabled)
    );
    listenForRedraw(uiModel.punctualLightsEnabled);

    uiModel.environmentRotation.subscribe((environmentRotation) => {
        switch (environmentRotation) {
            case "+Z":
                state.renderingParameters.environmentRotation = 90.0;
                break;
            case "-X":
                state.renderingParameters.environmentRotation = 180.0;
                break;
            case "-Z":
                state.renderingParameters.environmentRotation = 270.0;
                break;
            case "+X":
                state.renderingParameters.environmentRotation = 0.0;
                break;
        }
    });
    listenForRedraw(uiModel.environmentRotation);

    uiModel.clearColor.subscribe(
        (clearColor) => (state.renderingParameters.clearColor = clearColor)
    );
    listenForRedraw(uiModel.clearColor);

    uiModel.animationPlay.subscribe((animationPlay) => {
        if (animationPlay) {
            state.animationTimer.unpause();
        } else {
            state.animationTimer.pause();
        }
    });

    uiModel.activeAnimations.subscribe((animations) => (state.animationIndices = animations));
    listenForRedraw(uiModel.activeAnimations);

    uiModel.hdr.subscribe((hdr) => {
        resourceLoader.loadEnvironment(hdr.hdr_path).then((environment) => {
            state.environment = environment;
            // We need to wait until the environment is loaded to redraw
            redraw = true;
        });
    });

    uiModel.attachGltfLoaded(gltfLoaded);
    uiModel.updateValidationReport(validation);
    uiModel.updateStatistics(statisticsUpdateObservable);
    const sceneChangedStateObservable = uiModel.scene.pipe(map(() => state));
    uiModel.attachCameraChangeObservable(sceneChangedStateObservable);

    uiModel.orbit.subscribe((orbit) => {
        if (state.cameraNodeIndex === undefined) {
            state.userCamera.orbit(orbit.deltaPhi, orbit.deltaTheta);
        }
    });
    listenForRedraw(uiModel.orbit);

    uiModel.pan.subscribe((pan) => {
        if (state.cameraNodeIndex === undefined) {
            state.userCamera.pan(pan.deltaX, -pan.deltaY);
        }
    });
    listenForRedraw(uiModel.pan);

    uiModel.zoom.subscribe((zoom) => {
        if (state.cameraNodeIndex === undefined) {
            state.userCamera.zoomBy(zoom.deltaZoom);
        }
    });
    listenForRedraw(uiModel.zoom);

    listenForRedraw(gltfLoaded);

    // configure the animation loop
    const past = {};
    const update = () => {
        const devicePixelRatio = window.devicePixelRatio || 1;

        // set the size of the drawingBuffer based on the size it's displayed.
        canvas.width = Math.floor(canvas.clientWidth * devicePixelRatio);
        canvas.height = Math.floor(canvas.clientHeight * devicePixelRatio);
        if (cardinalOverlay) {
            syncOverlaySize(cardinalOverlay, canvas);
        }
        redraw |= !state.animationTimer.paused && state.animationIndices.length > 0;
        redraw |= mcmetaTextureAnimator.needsContinuousRedraw(state);
        redraw |= mcmetaTextureAnimator.update(state);
        redraw |= past.width != canvas.width || past.height != canvas.height;

        // Refit view if canvas changes significantly
        if (
            canvas.width / past.width < 0.5 ||
            canvas.width / past.width > 2.0 ||
            canvas.height / past.height < 0.5 ||
            canvas.height / past.height > 2.0
        ) {
            state.userCamera.perspective.aspectRatio = canvas.width / canvas.height;
            state.userCamera.fitViewToScene(state.gltf, state.sceneIndex);
        }

        past.width = canvas.width;
        past.height = canvas.height;

        if (redraw) {
            view.renderFrame(state, canvas.width, canvas.height);
            if (cardinalOverlay) {
                drawCardinalOverlay(cardinalOverlay, state, canvas.width, canvas.height);
            }
            redraw = false;
        }

        window.requestAnimationFrame(update);
    };

    // After this start executing animation loop.
    window.requestAnimationFrame(update);
};

function createCardinalOverlay(canvas) {
    const parent = canvas?.parentElement;
    if (!parent || typeof document === "undefined") {
        return null;
    }

    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.position === "static") {
        parent.style.position = "relative";
    }

    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.id = "cardinal-overlay";
    overlayCanvas.style.position = "absolute";
    overlayCanvas.style.left = "0";
    overlayCanvas.style.top = "0";
    overlayCanvas.style.pointerEvents = "none";
    overlayCanvas.style.zIndex = "2";
    parent.appendChild(overlayCanvas);

    const overlayContext = overlayCanvas.getContext("2d", { alpha: true });
    return {
        canvas: overlayCanvas,
        ctx: overlayContext
    };
}

function syncOverlaySize(overlay, targetCanvas) {
    if (!overlay?.canvas || !targetCanvas) {
        return;
    }

    const nextWidth = targetCanvas.width;
    const nextHeight = targetCanvas.height;
    if (overlay.canvas.width !== nextWidth) {
        overlay.canvas.width = nextWidth;
    }
    if (overlay.canvas.height !== nextHeight) {
        overlay.canvas.height = nextHeight;
    }

    const clientWidth = `${targetCanvas.clientWidth}px`;
    const clientHeight = `${targetCanvas.clientHeight}px`;
    if (overlay.canvas.style.width !== clientWidth) {
        overlay.canvas.style.width = clientWidth;
    }
    if (overlay.canvas.style.height !== clientHeight) {
        overlay.canvas.style.height = clientHeight;
    }
}

function drawCardinalOverlay(overlay, state, width, height) {
    const ctx = overlay?.ctx;
    if (!ctx) {
        return;
    }

    ctx.clearRect(0, 0, width, height);

    if (!state?.gltf || width <= 0 || height <= 0) {
        return;
    }

    const camera = getActiveCamera(state);
    if (!camera) {
        return;
    }

    const centerWorld = getSceneCenter(state);
    const radiusWorld = Math.max(1, getSceneRadius(state) * 0.35);
    const viewMatrix = camera.getViewMatrix(state.gltf);
    const projectionMatrix = camera.getProjectionMatrix(width / Math.max(1, height));
    const viewProjectionMatrix = mat4.create();
    mat4.multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);

    const projectedCenter = projectWorldPoint(centerWorld, viewProjectionMatrix, width, height);
    if (!projectedCenter) {
        drawCornerLegend(ctx, width);
        return;
    }

    const directions = [
        { label: "N", axis: [0, 0, -1], color: "#6ac3ff" },
        { label: "S", axis: [0, 0, 1], color: "#ffbf66" },
        { label: "E", axis: [1, 0, 0], color: "#ff7f7f" },
        { label: "W", axis: [-1, 0, 0], color: "#80d88a" }
    ];

    for (const direction of directions) {
        const tip = [
            centerWorld[0] + direction.axis[0] * radiusWorld,
            centerWorld[1] + direction.axis[1] * radiusWorld,
            centerWorld[2] + direction.axis[2] * radiusWorld
        ];
        const projectedTip = projectWorldPoint(tip, viewProjectionMatrix, width, height);
        if (!projectedTip) {
            continue;
        }
        drawDirection(ctx, projectedCenter, projectedTip, direction.label, direction.color);
    }

    drawCornerLegend(ctx, width);
}

function getActiveCamera(state) {
    if (!state?.gltf) {
        return null;
    }

    if (state.cameraNodeIndex === undefined) {
        return state.userCamera ?? null;
    }

    const node = state.gltf.nodes?.[state.cameraNodeIndex];
    if (!node || !Number.isInteger(node.camera)) {
        return state.userCamera ?? null;
    }

    const camera = state.gltf.cameras?.[node.camera];
    if (!camera) {
        return state.userCamera ?? null;
    }

    camera.setNode(state.gltf, state.cameraNodeIndex);
    return camera;
}

function getSceneCenter(state) {
    const min = state?.userCamera?.sceneExtents?.min;
    const max = state?.userCamera?.sceneExtents?.max;
    if (!Array.isArray(min) && !isVectorLike(min)) {
        return [0, 0, 0];
    }
    if (!Array.isArray(max) && !isVectorLike(max)) {
        return [0, 0, 0];
    }
    return [
        (Number(min[0]) + Number(max[0])) * 0.5,
        (Number(min[1]) + Number(max[1])) * 0.5,
        (Number(min[2]) + Number(max[2])) * 0.5
    ];
}

function getSceneRadius(state) {
    const min = state?.userCamera?.sceneExtents?.min;
    const max = state?.userCamera?.sceneExtents?.max;
    if (!isVectorLike(min) || !isVectorLike(max)) {
        return 1;
    }
    const diagonal = vec3.distance(
        vec3.fromValues(Number(min[0]), Number(min[1]), Number(min[2])),
        vec3.fromValues(Number(max[0]), Number(max[1]), Number(max[2]))
    );
    return Number.isFinite(diagonal) && diagonal > 0 ? diagonal : 1;
}

function isVectorLike(value) {
    return (
        value &&
        Number.isFinite(Number(value[0])) &&
        Number.isFinite(Number(value[1])) &&
        Number.isFinite(Number(value[2]))
    );
}

function projectWorldPoint(point, viewProjectionMatrix, width, height) {
    const clip = vec4.fromValues(point[0], point[1], point[2], 1);
    vec4.transformMat4(clip, clip, viewProjectionMatrix);
    if (!Number.isFinite(clip[3]) || Math.abs(clip[3]) < 1e-6) {
        return null;
    }

    const invW = 1 / clip[3];
    const ndcX = clip[0] * invW;
    const ndcY = clip[1] * invW;
    if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) {
        return null;
    }

    return {
        x: (ndcX * 0.5 + 0.5) * width,
        y: (1 - (ndcY * 0.5 + 0.5)) * height
    };
}

function drawDirection(ctx, start, end, label, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "700 16px Roboto, sans-serif";
    ctx.fillStyle = "#f3f6ff";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    ctx.lineWidth = 3;
    ctx.strokeText(label, end.x + 8, end.y - 8);
    ctx.fillText(label, end.x + 8, end.y - 8);
    ctx.restore();
}

function drawCornerLegend(ctx, width) {
    const legend = "Minecraft axes: N=-Z, S=+Z, E=+X, W=-X";
    const paddingX = 12;
    const paddingY = 10;
    const x = Math.max(8, width - 380);
    const y = 8;

    ctx.save();
    ctx.font = "600 13px Roboto, sans-serif";
    const textWidth = ctx.measureText(legend).width;
    const boxWidth = Math.ceil(textWidth + paddingX * 2);
    const boxHeight = 32;
    ctx.fillStyle = "rgba(10, 12, 16, 0.72)";
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.strokeStyle = "rgba(220, 226, 238, 0.45)";
    ctx.strokeRect(x, y, boxWidth, boxHeight);
    ctx.fillStyle = "#e8edf8";
    ctx.fillText(legend, x + paddingX, y + paddingY + 8);
    ctx.restore();
}
