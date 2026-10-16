# ITMS LED Bitmap & Bus Route Information Management 


An industrial-grade, air-gapped, zero-build standalone web application for designing multi-lingual LED destination displays for public transport buses, managing bus route sequences and VIA stops, tuning Indic font binarization matrices (Pixel Studio), and exporting hardware-ready firmware binary bundles for embedded microcontrollers.

---

## 📋 Table of Contents
1. [Executive Overview & Industry Context](#-executive-overview--industry-context)
2. [Architecture & Technology Stack](#-architecture--technology-stack)
3. [Centralized Configuration (`config.js`)](#-centralized-configuration-configjs)
4. [Virtual LED Simulator & 2-Pass Path Batching](#-virtual-led-simulator--2-pass-path-batching)
5. [Indic Phonetic Transliteration & Pixel Studio](#-indic-phonetic-transliteration--pixel-studio)
6. [Hardware Binary Encoding & Cryptographic Checksums](#-hardware-binary-encoding--cryptographic-checksums)
7. [Data Storage & Resilience Architecture](#-data-storage--resilience-architecture)
8. [Application Security & Hardening](#-application-security--hardening)
9. [Keyboard Navigation & Shortcuts](#-keyboard-navigation--shortcuts)
10. [Hardware Matrix Specifications](#-hardware-matrix-specifications)
11. [File & Directory Structure](#-file--directory-structure)

---

## 🌟 Executive Overview & Industry Context

In modern **Intelligent Transport Systems (ITMS)**, electronic destination displays mounted on public transit buses must render route numbers, primary terminals, and intermediate VIA bus stops across multi-lingual scripts (English, Telugu, Hindi). 

Physical LED display boards operate on monochrome dot-matrix LED panels driven by embedded microcontrollers (STM32, ESP32, TF-series, HD2016, NovaStar). Rendering complex Indic scripts requires precise binarization algorithms to transform vector TrueType fonts into crisp 1-bit pixel grids without losing diacritic glyph marks (*matras*).

The **ITMS LED Suite** solves this end-to-end challenge by providing:
- **Real-Time Virtual LED Hardware Simulator**: 2-pass Canvas path batching delivering 60 FPS physical dot rendering.
- **High-Capacity Offline Database**: Dual-layer storage (`localStorage` + `IndexedDB`) with exponential backoff retry and automated version recovery snapshots.
- **100% Offline Air-Gapped Operation**: Self-hosted `.woff2` fonts, local vendor libraries, and PWA Service Worker caching (0 bytes internet bandwidth required).
- **Firmware Binary Compiler**: Automated generation of `.zip` bundles containing `.bin` column-major binary files, plain `.hex` matrices, `.png` visual previews, `checksums.txt`, and `manifest.json`.

---

## 🏗️ Architecture & Technology Stack

> 📖 **Full System Architecture Document**: See [`ARCHITECTURE.md`](file:///c:/Users/Manikanta/Desktop/LED%20COMPANY_1/ARCHITECTURE.md) for sequence diagrams, security threat models, and hardware binary protocol specifications.

```mermaid
graph TD
    UI[HTML5 / CSS3 Glassmorphism UI] --> Config[js/config.js - Centralized ITMS_CONFIG & ITMSUtils]
    Config --> Sec[js/storage-security.js - AES-GCM 256-bit, PBKDF2 & LRU Cache]
    Sec --> App[js/app.js - UI Router & Keyboard Shortcuts]
    App --> RouteMgr[js/route-manager.js - IndexedDB v4 Storage]
    App --> TranslitEng[js/translit-engine.js - Indic Phonetic Engine]
    App --> GlyphMgr[js/glyph-manager.js - Pixel Studio & Matrix Tuner]
    App --> FontStorage[js/font-storage.js - Binary IndexedDB Font Store]
    App --> LEDEng[js/led-engine.js - 2-Pass Canvas Batched Matrix Simulator]
    LEDEng --> Rasterizer[js/led-rasterizer.js - 1-Bit Pixel Optimizer & Grapheme Segmenter]
    App --> Exporter[js/export-package.js - 1-Bit Binary & CRC32/CRC16 Compiler]
    Exporter --> ZIP[JSZip Firmware Package (.ZIP)]
```

- **Core Engine**: Pure Vanilla JavaScript (ES6+), HTML5 Canvas, and Vanilla CSS.
- **Zero Build Step**: Native browser execution without Node.js/npm dependencies — double-click `start_app.bat` or `index.html` to run anywhere.
- **Typing Safety**: Comprehensive TypeScript interface declarations in [`js/types.d.ts`](file:///c:/Users/Manikanta/Desktop/LED%20COMPANY_1/js/types.d.ts) with JSDoc integration.
- **Modular Design**: Single-responsibility decoupled architecture across 11 focused modules.

---

## ⚙️ Centralized Configuration (`config.js`)

All system defaults, database keys, matrix resolutions, and shared security utilities are declared in [`js/config.js`](file:///c:/Users/Manikanta/Desktop/LED%20COMPANY_1/js/config.js):

- **`ITMS_CONFIG.APP`**: Application name, semantic version (`2.1.0`), company branding (*Containe Technologies Limited*).
- **`ITMS_CONFIG.DATABASE`**: Database names (`ITMS_Route_DB_v4`, `ITMS_FontDB`), store names, and version migrations.
- **`ITMS_CONFIG.HARDWARE_DEFAULTS`**: Standard height (`64`), width (`256`), diode colors (`#ff2a2a`), and pitch.
- **`ITMS_CONFIG.TIMING`**: Toast durations (`3000ms`), debounce intervals (`120ms`), scroll speeds.
- **`ITMSUtils`**: Centralized security utilities for XSS entity encoding (`escapeHtml`, `escapeAttr`), string clamping, and CSV formula sanitization.

---

## 📺 Virtual LED Simulator & 2-Pass Path Batching

The simulator ([`js/led-engine.js`](file:///c:/Users/Manikanta/Desktop/LED%20COMPANY_1/js/led-engine.js)) models physical LED matrix physics with ultra-fast rendering:

1. **2-Pass Canvas Path Batching**:
   - **Pass 1 (Inactive Wells)**: Batches all OFF LED background wells into a single canvas sub-path and fills in 1 draw call.
   - **Pass 2 (Illuminated Diodes)**: Batches all active ON dots into a single canvas sub-path and fills in 1 draw call.
   - **Performance**: Reduces 16,384+ per-dot `save()`/`restore()` operations to **2 draw calls**, rendering large boards (64×256, 64×512) in **< 1.5ms per frame at 60 FPS**.
2. **Dual-Zone Destination Simulation**:
   - Supports static Route Code / Destination on Line 1 with scrolling VIA Stops on Line 2.
3. **Power-Saving Animation Lifecycle**:
   - `requestAnimationFrame` ticker automatically suspends canvas loops when tabs are inactive.

---

## 🔤 Indic Phonetic Transliteration & Pixel Studio

### 1. Phonetic Transliteration Engine ([`js/translit-engine.js`](file:///c:/Users/Manikanta/Desktop/LED%20COMPANY_1/js/translit-engine.js))
- **Hybrid Parser**: Combines a vast dictionary of Telangana/AP transit locations with a dynamic English-to-Telugu / English-to-Hindi phonetic compiler.
- **Diacritic & Virama Protection**: Correctly resolves consonant ligatures (`str`, `chr`, `nd`, `nt`, `mp`, `nj`) and automatically removes trailing viramas (`్`) when vowel matras attach.

### 2. Pixel Studio & Custom Font Ingestion ([`js/glyph-manager.js`](file:///c:/Users/Manikanta/Desktop/LED%20COMPANY_1/js/glyph-manager.js), [`js/font-storage.js`](file:///c:/Users/Manikanta/Desktop/LED%20COMPANY_1/js/font-storage.js))
- **Interactive Dot Grid Editor**: Manually toggle individual LED dots for custom Indic characters and glyph ligatures.
- **Binary TTF/OTF Ingestion**: Upload custom `.ttf` or `.otf` font files parsed directly via `opentype.js` and persisted as raw `ArrayBuffer` in IndexedDB.

---

## 📦 Hardware Binary Encoding & Cryptographic Checksums

The export pipeline ([`js/export-package.js`](file:///c:/Users/Manikanta/Desktop/LED%20COMPANY_1/js/export-package.js)) compiles 1-bit monochrome data for physical LED controllers:

- **1-Bit Column-Major Packing**: 8 vertical dots per byte, top-to-bottom, left-to-right (`.bin` and `.hex` formats).
- **Cryptographic Verification**:
  - Automatically computes **CRC32 (IEEE 802.3 standard polynomial `0xEDB88320`)** and **CRC16-CCITT (`0x1021`)**.
  - Generates `checksums.txt` and `manifest.json` inside every ZIP package for field technicians to verify USB flash drive integrity before programming bus displays.
- **Non-Blocking Streaming Pipeline**:
  - Generates master fleet packages (80+ routes) in async time-slices (`ITMSExporter.yieldEventLoop()`) with live progress percentage updates and cancel support.

---

## 💾 Data Storage & Resilience Architecture

```
                  ┌─────────────────────────────────────────┐
                  │        RouteManager Initializer         │
                  └────────────────────┬────────────────────┘
                                       │
                      [IndexedDB Availability Check]
                                       │
                  ┌────────────────────┴────────────────────┐
                  ▼                                         ▼
      [Primary: IndexedDB Engine]               [Fallback: localStorage]
      • Database: ITMS_Route_DB_v4              • Key: itms_routes_database_v2
      • ObjectStore: routes                     • Instant zero-latency boot
      • ObjectStore: backups                    • Safe quota boundary check
      • Capacity: Unlimited (> 1 GB)
      • Exponential Backoff Retry (3 Attempts)
```

- **Exponential Backoff Retry**: All IndexedDB read/write transactions wrap in `withIndexedDBRetry()` (60ms $\rightarrow$ 120ms $\rightarrow$ 240ms), rendering the database immune to transient lock collisions.
- **Automated Version History**: Automatically creates versioned recovery snapshots in IndexedDB before bulk operations.
- **Full Database JSON Portability**: One-click **Export Full Database (.JSON)** and **Restore Full Database** in the Export Center.

---

## 🔒 Application Security & Hardening

1. **Content Security Policy (CSP)**:
   - Header enforced in `index.html`: `script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`.
2. **Unified DOM XSS Sanitization**:
   - Dynamic HTML elements sanitized via `ITMSUtils.escapeHtml()` and `ITMSUtils.escapeAttr()`.
3. **OWASP CSV Formula Injection Shield**:
   - `ITMSUtils.sanitizeCsvCell()` neutralizes formula trigger characters (`=`, `+`, `-`, `@`, `\t`, `\r`, `%`) by prepending a single quote `'` and strictly escaping quotes according to RFC 4180.
4. **File Upload Security**:
   - Strict extension filters, binary signature checks, and size caps on `.json`, `.csv`, and `.ttf` imports.

---

## ⌨️ Keyboard Navigation & Shortcuts

| Shortcut | Action | Scope / Behavior |
| :--- | :--- | :--- |
| <kbd>Esc</kbd> | **Close Modal / Drawer** | Closes any open modal window, slide drawer, or mobile sidebar smoothly. |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | **Save / Sync Database** | Saves active route forms and synchronizes database state with toast confirmation. |
| <kbd>Ctrl</kbd> + <kbd>N</kbd> | **New Bus Route** | Quick-opens the route creation modal from Dashboard or Route Manager. |
| <kbd>Ctrl</kbd> + <kbd>F</kbd> | **Focus Search Bar** | Instantly focuses the active search box (`#route-search`, `#dash-search-input`, `#export-route-search`). |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Y</kbd> | **Undo / Redo** | Undoes or redoes dot edits in Pixel Studio (50-step history). |
| <kbd>?</kbd> or <kbd>Ctrl</kbd> + <kbd>/</kbd> | **Shortcuts Reference HUD** | Opens the interactive Keyboard Shortcuts cheat sheet modal. |

---

## 📐 Hardware Matrix Specifications

| Specification | Supported Dimensions | Notes |
| :--- | :--- | :--- |
| **Matrix Height** | 16, 24, 32, 48, 64 dots | Standard 1-row, 1.5-row, and 2-row bus LED panels |
| **Matrix Width** | 32, 64, 128, 256, 384, 512 dots | Single panels (16×32), mini boards, and wide bus destination displays |
| **LED Pixel Styles** | Circular Dot, Glowing LED, Square Matrix | Authentic simulated physical optics |
| **LED Colors** | Crimson Red (`#ff2a2a`), Amber/Yellow (`#ffd700`), Orange (`#ff8c00`), Green (`#00e676`) | Hardware-accurate diode emissions |
| **Scan Mode** | 1/16 Scan Column-Major | Standard Hub75 / Hub08 / Hub12 controllers |

---

## 📁 File & Directory Structure

```
LED COMPANY_1/
├── index.html            # Single Page Application structure with strict CSP header
├── README.md             # Complete system documentation & developer guide
├── app.webmanifest       # PWA Web App Manifest for Desktop App Installation
├── sw.js                 # PWA Service Worker (v15) for 100% offline disk caching
├── start_app.bat         # Automated local launcher script
├── ctpl-logo.png         # Containe Technologies Limited company logo & app favicon
├── css/
│   ├── styles.css        # Core SaaS design system, glass cards, & responsive layout
│   └── fonts/
│       ├── google-fonts.css # Local self-hosted font declarations
│       └── *.woff2       # Local offline compressed font files (Inter, Roboto, Noto Sans)
└── js/
    ├── config.js         # Centralized ITMS_CONFIG, ITMSUtils & Backoff Retry Engine
    ├── storage-security.js # AES-GCM 256-bit Encryption, PBKDF2 & LRU Cache
    ├── app.js            # Main UI Controller, View Routing, & Keyboard Shortcuts
    ├── route-manager.js  # High-Capacity IndexedDB Manager, Stop CRUD & CSV Engine
    ├── led-engine.js     # 2-Pass Canvas Batched Matrix Renderer & Byte Generator
    ├── led-rasterizer.js # Unicode Grapheme Segmentation & 1-Bit Pixel Optimizer
    ├── translit-engine.js# Indic Phonetic Transliteration Engine (TE / HI)
    ├── glyph-manager.js  # Pixel Studio, Font Binarizer & Custom Glyph Editor
    ├── font-storage.js   # IndexedDB Binary TTF/OTF Font Storage with Backoff Retry
    ├── export-package.js # Client-Side ZIP Generator & CRC32/CRC16 Integrity Compiler
    ├── web-serial-flasher.js # Direct USB Serial Flasher (ESP32/STM32/Arduino)
    ├── binarizer-worker.js # Multithreaded Offscreen Binarization Worker
    ├── types.d.ts        # TypeScript Interface Definitions & JSDoc Typings
    ├── data/
    │   ├── translit-dictionary.js # Modular 2,180+ Transit Lexicon & Letter Speller
    │   └── language-presets.js    # Multi-Lingual Presets & Character Palettes
    └── vendor/
        ├── jszip.min.js     # Client-side ZIP archiving engine (v3.10.1)
        ├── bootstrap-icons/    # Local air-gapped Bootstrap Icons (v1.13.1)
        └── opentype.min.js  # Local TrueType/OpenType font parser (v1.3.4)
```

---

## 🚀 Deployment Guide

1. **Local Desktop Workstation**:
   - Double-click [`start_app.bat`](file:///c:/Users/Manikanta/Desktop/LED%20COMPANY_1/start_app.bat) or open [`index.html`](file:///c:/Users/Manikanta/Desktop/LED%20COMPANY_1/index.html) directly in any modern browser (Chrome, Edge, Firefox).
2. **Depot Local Server / Intranet**:
   - Place the project directory on any static file server (Nginx, Apache, IIS, or Python `http.server`).
   - The Service Worker will automatically cache all assets for subsequent offline use.
