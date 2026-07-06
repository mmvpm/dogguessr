import { createReadStream, existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = path.resolve(__dirname, "..");
const rootFiles = ["breed_map.json", "dataset.csv", "breed-similarity.csv", "image_manifest.json"];

export default defineConfig({
  plugins: [react(), staticDogguessrData()],
  server: {
    port: 5173
  }
});

function staticDogguessrData(): Plugin {
  return {
    name: "static-dogguessr-data",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split("?")[0] ?? "";
        const rootFile = rootFiles.find((file) => url === `/${file}`);
        const filePath = rootFile
          ? path.join(projectRoot, rootFile)
          : url.startsWith("/dataset/")
            ? safeDatasetPath(url)
            : null;

        if (!filePath || !existsSync(filePath)) {
          next();
          return;
        }

        response.setHeader("Content-Type", contentType(filePath));
        createReadStream(filePath).pipe(response);
      });
    },
    closeBundle() {
      const outputDir = path.resolve(__dirname, "dist");
      mkdirSync(outputDir, { recursive: true });
      for (const file of rootFiles) {
        const source = path.join(projectRoot, file);
        if (existsSync(source)) {
          copyFileSync(source, path.join(outputDir, file));
        }
      }
    }
  };
}

function safeDatasetPath(url: string): string | null {
  const decoded = decodeURIComponent(url);
  const filePath = path.normalize(path.join(projectRoot, decoded.slice(1)));
  return filePath.startsWith(path.join(projectRoot, "dataset") + path.sep) ? filePath : null;
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (filePath.endsWith(".csv")) {
    return "text/csv; charset=utf-8";
  }
  if (filePath.endsWith(".png")) {
    return "image/png";
  }
  if (filePath.endsWith(".gif")) {
    return "image/gif";
  }
  if (filePath.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}
