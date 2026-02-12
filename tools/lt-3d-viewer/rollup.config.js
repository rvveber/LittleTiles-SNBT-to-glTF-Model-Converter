import glslify from "rollup-plugin-glslify";
import resolve from "@rollup/plugin-node-resolve";
import scss from "rollup-plugin-scss";
import commonjs from "@rollup/plugin-commonjs";
import del from "rollup-plugin-delete";
import replace from "@rollup/plugin-replace";
import { wasm } from "@rollup/plugin-wasm";
import path from "path";
import fs from "fs";
import * as sass from "sass";

const rendererRoot = "../../subrepos/glTF-Sample-Viewer/glTF-Sample-Renderer";

function copyFiles(from, to, overwrite = false) {
  return {
    name: "copy-files",
    generateBundle() {
      const log = (msg) => console.log("\x1b[36m%s\x1b[0m", msg);
      log("copy files:");
      if (!fs.existsSync(to)) {
        fs.mkdirSync(to, { recursive: true });
      }
      fs.readdirSync(from).forEach((file) => {
        const fromFile = `${from}/${file}`;
        const toFile = `${to}/${file}`;
        if (fs.existsSync(toFile) && !overwrite) return;
        log(`• ${fromFile} → ${toFile}`);
        fs.copyFileSync(path.resolve(fromFile), path.resolve(toFile));
      });
    },
  };
}

function copyFile(from, to, file, overwrite = false) {
  return {
    name: "copy-file",
    generateBundle() {
      const log = (msg) => console.log("\x1b[36m%s\x1b[0m", msg);
      if (!fs.existsSync(to)) {
        fs.mkdirSync(to, { recursive: true });
      }
      const fromFile = `${from}/${file}`;
      const toFile = `${to}/${file}`;
      if (fs.existsSync(toFile) && !overwrite) return;
      log(`copy file: ${fromFile} → ${toFile}`);
      fs.copyFileSync(path.resolve(fromFile), path.resolve(toFile));
    },
  };
}

export default {
  input: "src/main.js",
  output: [
    {
      name: "Lt3DViewerApp",
      file: "dist/Lt3DViewerApp.js",
      format: "esm",
      sourcemap: true,
    },
  ],
  plugins: [
    wasm(),
    glslify({
      include: [`${rendererRoot}/source/Renderer/shaders/*`, `${rendererRoot}/source/shaders/*`],
      compress: false,
    }),
    resolve({
      browser: true,
      preferBuiltins: true,
      dedupe: ["gl-matrix", "jpeg-js", "fast-png"],
    }),
    scss({
      sass,
      quietDeps: true,
      verbose: false,
    }),
    del({ targets: "dist/*" }),
    copyFile(".", "./dist", "index.html", true),
    copyFile(".", "./dist", "main.js", true),
    copyFiles("./assets/ui", "./dist/assets/ui", true),
    copyFiles(`${rendererRoot}/source/libs`, "./dist/libs", true),
    copyFiles(`${rendererRoot}/assets/images`, "./dist/assets/images", true),
    replace({
      "process.env.NODE_ENV": JSON.stringify("production"),
      preventAssignment: true,
    }),
    commonjs(),
  ],
};
