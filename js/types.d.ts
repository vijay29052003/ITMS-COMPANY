/**
 * @file types.d.ts
 * @description Comprehensive TypeScript & JSDoc Type Definitions for ITMS LED Bitmap & Route Management Suite.
 * Provides strict structural typing for hardware matrices, routes, stops, fonts, binarization, and export packages.
 * @author Containe Technologies Limited
 */

/**
 * Supported LED Matrix Heights in pixels (dots)
 */
export type LEDMatrixHeight = 16 | 24 | 32 | 48 | 64;

/**
 * Supported LED Matrix Widths in pixels (dots)
 */
export type LEDMatrixWidth = 64 | 96 | 128 | 192 | 256 | 384 | 512;

/**
 * Supported Visual Styles for simulated LED physical pixels
 */
export type LEDPixelStyle = 'circle' | 'square' | 'glow';

/**
 * Marquee animation & scrolling movement modes
 */
export type LEDScrollMode = 'static' | 'scroll-left' | 'scroll-right' | 'blink';

/**
 * Hex color representation of physical LED displays
 */
export type LEDColorHex = '#ff2a2a' | '#ffd700' | '#ff8c00' | '#00e676' | string;

/**
 * Supported Indian and Latin language codes
 */
export type SupportedLanguageCode = 'en' | 'te' | 'hi' | 'ta' | 'kn' | 'ml';

/**
 * 2D 1-bit Binary Matrix: matrix[row][col] -> 0 (LED OFF) or 1 (LED ON)
 */
export type BinaryMatrix = (0 | 1)[][];

/**
 * Represents an individual transit stop in an ordered route sequence
 */
export interface RouteStop {
  /** Unique sequential or alphanumeric identifier */
  id: string;
  /** Stop name in English */
  name: string;
  /** Stop name in Telugu */
  nameTe?: string;
  /** Stop name in Hindi */
  nameHi?: string;
  /** Stop name in Tamil */
  nameTa?: string;
  /** Stop name in Kannada */
  nameKn?: string;
  /** Stop name in Malayalam */
  nameMl?: string;
  /** 1-based order sequence index in the bus route */
  sequence: number;
  /** Optional GPS latitude for geofence trigger */
  lat?: number;
  /** Optional GPS longitude for geofence trigger */
  lng?: number;
  /** Distance in meters from previous stop */
  distanceMeters?: number;
}

/**
 * Complete Bus Route entity containing multi-lingual terminals, code, and stops sequence
 */
export interface BusRoute {
  /** Unique route ID (e.g. route_1700000000_1_abc123) */
  id: string;
  /** Bus route service code (e.g., '10H', '222A', 'AC-1') */
  code: string;
  /** Descriptive name of the route */
  name: string;
  /** Origin terminal in English */
  start: string;
  /** Destination terminal in English */
  end: string;
  /** Origin terminal in Telugu */
  startTe: string;
  /** Destination terminal in Telugu */
  endTe: string;
  /** Origin terminal in Hindi */
  startHi?: string;
  /** Destination terminal in Hindi */
  endHi?: string;
  /** Origin terminal in Tamil */
  startTa?: string;
  /** Destination terminal in Tamil */
  endTa?: string;
  /** Origin terminal in Kannada */
  startKn?: string;
  /** Destination terminal in Kannada */
  endKn?: string;
  /** Origin terminal in Malayalam */
  startMl?: string;
  /** Destination terminal in Malayalam */
  endMl?: string;
  /** Array of intermediate and terminal stops in traversal order */
  stops: RouteStop[];
  /** Flag indicating if route is currently deployed/active */
  active?: boolean;
  /** Creation or last-modified timestamp in milliseconds */
  timestamp?: number;
  /** Display duration on LED board in seconds */
  displayDurationSec?: number;
  /** Flag indicating if this is an inverted return route */
  isReturnRoute?: boolean;
}

/**
 * Represents a saved custom glyph or text pattern in the Glyph Library
 */
export interface SavedGlyph {
  /** Unique glyph entry identifier */
  id: string;
  /** Text content represented */
  text: string;
  /** Target language identifier (e.g. 'telugu', 'hindi', 'english') */
  language: string;
  /** Font family used during binarization */
  fontName: string;
  /** Optional custom font identifier if tuned with uploaded font */
  customFontId?: string;
  /** Dot matrix grid width in pixels */
  gridWidth: number;
  /** Dot matrix grid height in pixels */
  gridHeight: number;
  /** 1-bit thresholding value (0-255) */
  threshold: number;
  /** Contrast multiplier applied */
  contrast?: number;
  /** LED color for visual preview */
  ledColor: LEDColorHex;
  /** Binary matrix data (array of rows) */
  matrix: BinaryMatrix;
  /** Creation timestamp */
  timestamp: number;
  /** Human-readable date string */
  dateStr?: string;
}

/**
 * Custom font record stored in IndexedDB (Zero-Quota-Overflow)
 */
export interface CustomFontRecord {
  /** Unique font identifier */
  id: string;
  /** Display name of the font */
  name: string;
  /** CSS font-family name */
  family: string;
  /** Font format descriptor */
  format: 'truetype' | 'opentype' | 'woff' | 'woff2' | string;
  /** Raw binary ArrayBuffer of font file (no Base64 inflation) */
  buffer: ArrayBuffer;
  /** File size in bytes */
  size: number;
  /** Parsed glyph count from font tables */
  glyphCount?: number;
  /** Upload timestamp in milliseconds */
  timestamp: number;
}

/**
 * Configuration options for the canvas LED rendering engine
 */
export interface LEDEngineConfig {
  text: string;
  fontFamily: string;
  fontSize: number;
  matrixHeight: LEDMatrixHeight;
  matrixWidth: LEDMatrixWidth;
  threshold: number;
  pixelStyle: LEDPixelStyle;
  ledColor: LEDColorHex;
  ledColorGlow?: string;
  dotRadius?: number;
  dotSpacing?: number;
  offColor?: string;
  offsetX: number;
  offsetY: number;
  bold?: boolean;
  isInteractive?: boolean;
  scrollMode: LEDScrollMode;
  scrollSpeed: number;
}

/**
 * Configuration options for Glyph Manager and interactive dot studio
 */
export interface GlyphManagerConfig {
  fontFamily: string;
  customFontName: string;
  matrixHeight: LEDMatrixHeight;
  matrixWidthMode: string;
  matrixWidth: number;
  scrollMode: LEDScrollMode;
  pixelStyle: LEDPixelStyle;
  ledColor: LEDColorHex;
  offsetX: number;
  offsetY: number;
  threshold: number;
  useSuperSampling: boolean;
  exportFormat: 'C-ARRAY' | 'HEX-STREAM' | 'BINARY-RAW' | 'BIN-ARRAY' | 'JSON' | 'BASE64' | 'PYTHON';
}

/**
 * Web Worker Binarizer message payload
 */
export interface BinarizerWorkerRequest {
  type: 'PROCESS_BINARIZATION';
  id: number;
  pixelsBuffer: ArrayBuffer;
  renderWidth: number;
  renderHeight: number;
  rows: number;
  cols: number;
  oversample: number;
  minCoverageRatio: number;
}

/**
 * Web Worker Binarizer response payload
 */
export interface BinarizerWorkerResponse {
  type: 'BINARIZATION_COMPLETE';
  id: number;
  matrix: BinaryMatrix;
}

/**
 * Checksum and binary integrity metadata for firmware files
 */
export interface FileChecksumMeta {
  path: string;
  sizeBytes: number;
  crc32: string;
  crc16: string;
}

/**
 * Overall package integrity descriptor for STM32 / ESP32 bootloaders
 */
export interface PackageIntegrityMeta {
  totalFiles: number;
  totalBytes: number;
  masterCrc32: string;
  masterCrc16: string;
  algorithmCrc32: string;
  algorithmCrc16: string;
}

/**
 * Unified Full Database Backup JSON Schema
 */
export interface ITMSFullDatabaseBackup {
  backupVersion: string;
  system: string;
  generator: string;
  exportTimestamp: string;
  stats: {
    totalRoutes: number;
    totalStops: number;
    totalGlyphs: number;
  };
  routes: BusRoute[];
  glyphs: SavedGlyph[];
}

/**
 * Bulk CSV / Excel Import Row parsed item
 */
export interface BulkImportRow {
  routeCode: string;
  routeName: string;
  stopSequence?: number;
  stopEn?: string;
  stopTe?: string;
  stopHi?: string;
  startEn?: string;
  startTe?: string;
  destEn?: string;
  destTe?: string;
}

/**
 * Bulk Import Result summary
 */
export interface BulkImportResult {
  success: boolean;
  totalParsedRoutes: number;
  totalParsedStops: number;
  routes: BusRoute[];
  errors: string[];
}

/**
 * Hardware Export Package Manifest definition
 */
export interface ITMSPackageManifest {
  packageVersion: string;
  createdTimestamp: string;
  system: string;
  packageIntegrity?: PackageIntegrityMeta;
  hardwareSpecs: {
    matrixWidth: number;
    matrixHeight: number;
    colorDepth: string;
    scanMode: string;
  };
  routeInfo: {
    id: string;
    code: string;
    name: string;
    totalStops: number;
    supportedLanguages: string[];
    headerFiles?: Record<string, FileChecksumMeta>;
  };
  stopsSequence: Array<{
    sequence: number;
    stopId: string;
    names: {
      en: string;
      te: string;
      hi: string;
    };
    binaryFiles: Record<string, string>;
    filesMeta?: Record<string, FileChecksumMeta>;
  }>;
}

