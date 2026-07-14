import child_process from "node:child_process";
import electron from "electron";
import esbuild from "esbuild";

const isDev = !process.argv.includes("--prod");

const electronRunner = (() => {
  let handle = null;
  return {
    restart() {
      console.info("Restarting Electron process.");
      if (handle) handle.kill();
      handle = child_process.spawn(electron, ["."], { stdio: "inherit" });
    },
  };
})();

const mainCtx = await esbuild.context({
  entryPoints: ["src/main/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  minify: !isDev,
  external: ["electron", "uiohook-napi"],
  outfile: "dist/main.js",
  plugins: isDev
    ? [
        {
          name: "electron-runner",
          setup(build) {
            build.onEnd((result) => {
              if (!result.errors.length) electronRunner.restart();
            });
          },
        },
      ]
    : [],
});

const preloadCtx = await esbuild.context({
  entryPoints: ["src/main/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  minify: !isDev,
  external: ["electron"],
  outfile: "dist/preload.js",
});

const rendererCtx = await esbuild.context({
  entryPoints: ["src/renderer/renderer.ts"],
  bundle: true,
  platform: "browser",
  minify: !isDev,
  outfile: "dist/renderer.js",
});

if (isDev) {
  await mainCtx.watch();
  await preloadCtx.watch();
  await rendererCtx.watch();
} else {
  await mainCtx.rebuild();
  await preloadCtx.rebuild();
  await rendererCtx.rebuild();
  mainCtx.dispose();
  preloadCtx.dispose();
  rendererCtx.dispose();
}
