// Renders the PWA / app-store icons from the SVG sources (uses sharp, bundled with Next.js).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH ?? "sharp");
const jobs = [
  ["public/icons/icon.svg", "public/icons/icon-192.png", 192],
  ["public/icons/icon.svg", "public/icons/icon-512.png", 512],
  ["public/icons/maskable.svg", "public/icons/maskable-192.png", 192],
  ["public/icons/maskable.svg", "public/icons/maskable-512.png", 512],
  ["public/icons/icon.svg", "public/icons/apple-touch-icon.png", 180],
  ["public/icons/icon.svg", "public/icons/favicon-32.png", 32],
  ["public/icons/maskable.svg", "public/icons/store-1024.png", 1024],
];
for (const [src, out, size] of jobs) await sharp(src, { density: 600 }).resize(size, size).png().toFile(out);
console.log("icons written");
