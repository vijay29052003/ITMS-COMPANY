/**
 * @file scripts/build.js
 * @description Production Build Optimizer & Bundler for ITMS LED Destination Suite.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m'
};

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');

// Ordered JavaScript dependency list for bundling
const jsBundleFiles = [
  'js/config.js',
  'js/storage-security.js',
  'js/input-validator.js',
  'js/error-handler.js',
  'js/loading-manager.js',
  'js/state-manager.js',
  'js/data/language-presets.js',
  'js/data/translit-dictionary.js',
  'js/font-storage.js',
  'js/translit-engine.js',
  'js/led-rasterizer.js',
  'js/led-engine.js',
  'js/route-manager.js',
  'js/export-package.js',
  'js/glyph-manager.js',
  'js/web-serial-flasher.js',
  'js/app.js'
];

/**
 * Minifies CSS stylesheet by stripping comments, collapsing whitespace, and compressing symbols.
 * @param {string} css 
 * @returns {string}
 */
function minifyCSS(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '') // remove comments
    .replace(/\s+/g, ' ') // collapse whitespace
    .replace(/\s*([\{\}:;,>+~])\s*/g, '$1') // trim around operators
    .replace(/;}/g, '}') // remove trailing semicolon
    .trim();
}

/**
 * Minifies JavaScript by safely stripping comments and collapsing whitespace.
 * @param {string} code 
 * @returns {string}
 */
function minifyJS(code) {
  // Strip multi-line comments that do not start with /*!
  let out = code.replace(/\/\*(?![\!#])[\s\S]*?\*\//g, '');
  
  // Strip trailing single line comments safely (not inside quotes)
  const lines = out.split('\n');
  const cleanLines = [];
  
  for (let line of lines) {
    let trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//') && !trimmed.startsWith('///')) continue;
    cleanLines.push(trimmed);
  }
  
  return cleanLines.join('\n');
}

/**
 * Minifies HTML structure.
 * @param {string} html 
 * @returns {string}
 */
function minifyHTML(html) {
  return html
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '') // remove comments
    .replace(/>\s+</g, '><') // remove whitespace between tags
    .trim();
}

/**
 * Recursively copies a directory
 * @param {string} src 
 * @param {string} dest 
 */
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Main build execution
 */
async function build() {
  console.log(`\n${colors.bright}${colors.cyan}══════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  ⚡ ITMS LED Suite - Production Build & Optimization Pipeline${colors.reset}`);
  console.log(`${colors.cyan}══════════════════════════════════════════════════════════════════════${colors.reset}\n`);

  const startTime = Date.now();

  // 1. Clean & recreate dist directory
  console.log(`${colors.yellow}1. Cleaning and preparing dist/ directory...${colors.reset}`);
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(path.join(distDir, 'js'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'css'), { recursive: true });

  // 2. Process & Minify CSS
  console.log(`${colors.yellow}2. Minifying CSS styles and copying web fonts...${colors.reset}`);
  const srcCssPath = path.join(rootDir, 'css', 'styles.css');
  const rawCss = fs.readFileSync(srcCssPath, 'utf8');
  const minifiedCss = minifyCSS(rawCss);
  const destCssPath = path.join(distDir, 'css', 'styles.min.css');
  fs.writeFileSync(destCssPath, minifiedCss, 'utf8');

  // Copy CSS fonts directory if present
  const fontsSrc = path.join(rootDir, 'css', 'fonts');
  if (fs.existsSync(fontsSrc)) {
    copyDirSync(fontsSrc, path.join(distDir, 'css', 'fonts'));
  }

  // 3. Bundle & Minify JavaScript
  console.log(`${colors.yellow}3. Bundling and optimizing JavaScript modules...${colors.reset}`);
  let rawJsSize = 0;
  const jsChunks = [];

  for (const relFile of jsBundleFiles) {
    const fullPath = path.join(rootDir, relFile);
    if (fs.existsSync(fullPath)) {
      const code = fs.readFileSync(fullPath, 'utf8');
      rawJsSize += Buffer.byteLength(code, 'utf8');
      jsChunks.push(`\n/* --- [MODULE] ${relFile} --- */\n` + code);
    }
  }

  const combinedJs = jsChunks.join('\n;\n');
  const minifiedJs = minifyJS(combinedJs);
  const destJsPath = path.join(distDir, 'js', 'bundle.min.js');
  fs.writeFileSync(destJsPath, minifiedJs, 'utf8');

  // Copy vendor and worker scripts to dist/js
  const vendorSrc = path.join(rootDir, 'js', 'vendor');
  if (fs.existsSync(vendorSrc)) {
    copyDirSync(vendorSrc, path.join(distDir, 'js', 'vendor'));
  }
  const workerSrc = path.join(rootDir, 'js', 'binarizer-worker.js');
  if (fs.existsSync(workerSrc)) {
    fs.copyFileSync(workerSrc, path.join(distDir, 'js', 'binarizer-worker.js'));
  }

  // 4. Generate Content Hash & Process index.html
  console.log(`${colors.yellow}4. Generating production index.html with cache-busting hashes...${colors.reset}`);
  const buildHash = crypto.createHash('md5').update(minifiedJs + minifiedCss).digest('hex').slice(0, 8);
  
  let rawHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  
  // Replace CSS link
  rawHtml = rawHtml.replace(/<link rel="stylesheet" href="css\/styles\.css[^"]*">/, `<link rel="stylesheet" href="css/styles.min.css?v=${buildHash}">`);

  // Replace all individual script tags with the bundled minified script tag
  const firstScriptRegex = /<script src="js\/config\.js[^"]*"><\/script>/;
  const bundleScriptTag = `<!-- Production Optimized JS Bundle -->\n  <script src="js/bundle.min.js?v=${buildHash}"></script>`;
  rawHtml = rawHtml.replace(firstScriptRegex, bundleScriptTag);

  // Remove the remaining individual script references that are now bundled
  for (const relFile of jsBundleFiles) {
    if (relFile === 'js/config.js') continue;
    const scriptRegex = new RegExp(`\\s*<script src="${relFile.replace('/', '\\/')}[^"]*"><\\/script>`, 'g');
    rawHtml = rawHtml.replace(scriptRegex, '');
  }

  fs.writeFileSync(path.join(distDir, 'index.html'), rawHtml, 'utf8');

  // 5. Copy Static Assets (Logo, PWA Manifest, Service Worker)
  console.log(`${colors.yellow}5. Copying PWA assets, icons, and service worker...${colors.reset}`);
  const staticAssets = ['ctpl-logo.png', 'app.webmanifest', 'sw.js', 'README.md'];
  for (const asset of staticAssets) {
    const assetSrc = path.join(rootDir, asset);
    if (fs.existsSync(assetSrc)) {
      fs.copyFileSync(assetSrc, path.join(distDir, asset));
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Calculate Size Savings
  const origCssBytes = Buffer.byteLength(rawCss, 'utf8');
  const minCssBytes = Buffer.byteLength(minifiedCss, 'utf8');
  const minJsBytes = Buffer.byteLength(minifiedJs, 'utf8');
  const origTotalBytes = origCssBytes + rawJsSize;
  const minTotalBytes = minCssBytes + minJsBytes;
  const savedBytes = origTotalBytes - minTotalBytes;
  const savedPercent = ((savedBytes / origTotalBytes) * 100).toFixed(1);

  // 6. Print Performance Report
  console.log(`\n${colors.cyan}──────────────────────────────────────────────────────────────────────${colors.reset}`);
  console.log(`${colors.bright}📦 Production Build Summary (v3.3.0 - Hash: ${buildHash}):${colors.reset}\n`);
  console.log(`  File                    Original       Minified       Savings`);
  console.log(`  ─────────────────────────────────────────────────────────────`);
  console.log(`  css/styles.min.css     ${(origCssBytes / 1024).toFixed(1).padStart(6)} KB    ${(minCssBytes / 1024).toFixed(1).padStart(6)} KB    ${colors.green}${(((origCssBytes - minCssBytes) / origCssBytes) * 100).toFixed(1)}%${colors.reset}`);
  console.log(`  js/bundle.min.js       ${(rawJsSize / 1024).toFixed(1).padStart(6)} KB    ${(minJsBytes / 1024).toFixed(1).padStart(6)} KB    ${colors.green}${(((rawJsSize - minJsBytes) / rawJsSize) * 100).toFixed(1)}%${colors.reset}`);
  console.log(`  ─────────────────────────────────────────────────────────────`);
  console.log(`  Total Core Assets:     ${(origTotalBytes / 1024).toFixed(1).padStart(6)} KB    ${(minTotalBytes / 1024).toFixed(1).padStart(6)} KB    ${colors.green}${savedPercent}% (${(savedBytes / 1024).toFixed(1)} KB saved)${colors.reset}`);
  console.log(`\n  Build Target:  ${distDir}`);
  console.log(`  Build Time:    ${duration}s`);
  console.log(`${colors.cyan}──────────────────────────────────────────────────────────────────────${colors.reset}\n`);
  console.log(`${colors.green}${colors.bright}✔ PRODUCTION BUILD COMPLETED SUCCESSFULLY!${colors.reset}\n`);
}

build().catch(err => {
  console.error('Fatal error during build:', err);
  process.exit(1);
});
