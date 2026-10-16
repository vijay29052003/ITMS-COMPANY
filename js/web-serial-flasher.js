/**
 * ============================================================================
 * ITMS WEB SERIAL & DIRECT USB HARDWARE FLASHER MODULE
 * ============================================================================
 * Company: Containe Technologies Limited
 * Allows Google Chrome / MS Edge to connect directly to USB microcontrollers
 * (ESP32, STM32, Arduino, ARM Cortex-M) via the Web Serial API (navigator.serial)
 * and stream 1-bit column-major LED bitmaps and fleet binary bundles in real-time.
 * ============================================================================
 */

class WebSerialFlasher {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readableStreamClosed = null;
    this.writableStreamClosed = null;
    this.keepReading = false;
    this.baudRate = 115200;
    this.isFlashing = false;
    this.portInfo = null;

    // Event Callbacks
    this.onConnect = null;
    this.onDisconnect = null;
    this.onLog = null;
    this.onProgress = null;

    // Protocol Command Constants
    this.CMD_PING = 0x00;
    this.CMD_FLASH_BITMAP = 0x01;
    this.CMD_FLASH_FLEET_START = 0x02;
    this.CMD_FLASH_FLEET_CHUNK = 0x03;
    this.CMD_FLASH_FLEET_END = 0x04;
    this.CMD_RESET_DISPLAY = 0x05;

    // Packet Framing: Magic Bytes [0xAA, 0x55]
    this.MAGIC_HEADER = [0xAA, 0x55];

    // Bind Navigator Serial Disconnect Event
    if (this.isSupported() && typeof navigator.serial.addEventListener === 'function') {
      navigator.serial.addEventListener('disconnect', (e) => {
        if (this.port && e.target === this.port) {
          this.log('Hardware USB device disconnected by user.', 'warn');
          this.disconnect();
        }
      });
    }
  }

  /**
   * Checks if current browser supports Web Serial API (Chrome 89+, Edge 89+, Opera).
   * @returns {boolean}
   */
  isSupported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator && !!navigator.serial;
  }

  /**
   * Returns true if a serial port is currently open and writable.
   * @returns {boolean}
   */
  get isConnected() {
    return !!(this.port && this.port.writable);
  }

  /**
   * Emits a formatted log message to registered logger or console.
   */
  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = { timestamp, message, type };
    if (typeof this.onLog === 'function') {
      this.onLog(entry);
    }
  }

  /**
   * Opens the browser USB device picker and connects to selected microcontroller.
   * @param {number} [baudRate=115200]
   * @returns {Promise<boolean>}
   */
  async connect(baudRate = 115200) {
    if (!this.isSupported()) {
      throw new Error('Web Serial API is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
    }

    if (this.isConnected) {
      await this.disconnect();
    }

    this.baudRate = parseInt(baudRate, 10) || 115200;

    try {
      this.log(`Opening USB Port Picker dialog at ${this.baudRate} bps...`, 'info');
      this.port = await navigator.serial.requestPort();
      
      const info = this.port.getInfo ? this.port.getInfo() : {};
      this.portInfo = {
        usbVendorId: info.usbVendorId ? '0x' + info.usbVendorId.toString(16).toUpperCase() : 'USB Device',
        usbProductId: info.usbProductId ? '0x' + info.usbProductId.toString(16).toUpperCase() : ''
      };

      await this.port.open({
        baudRate: this.baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        bufferSize: 16384,
        flowControl: 'none'
      });

      this.log(`Successfully connected to USB Device [VID: ${this.portInfo.usbVendorId} PID: ${this.portInfo.usbProductId}] at ${this.baudRate} bps`, 'success');

      // Sync hardware state to ITMS.State
      if (typeof window !== 'undefined' && window.ITMS && window.ITMS.State) {
        window.ITMS.State.update('hardware', { serialConnected: true, baudRate: this.baudRate, portName: this.portInfo.usbVendorId });
      }

      // Start non-blocking incoming background reader
      this.startReading();

      if (typeof this.onConnect === 'function') {
        this.onConnect({ baudRate: this.baudRate, portInfo: this.portInfo });
      }

      return true;
    } catch (err) {
      this.port = null;
      if (typeof window !== 'undefined' && window.ITMS && window.ITMS.State) {
        window.ITMS.State.update('hardware', { serialConnected: false });
      }
      if (err.name === 'NotFoundError') {
        this.log('USB connection cancelled by user.', 'warn');
      } else {
        this.log(`USB Connection Failed: ${err.message || err}`, 'error');
        if (typeof window !== 'undefined' && window.ITMSErrorHandler) {
          window.ITMSErrorHandler.handleError(window.ITMSErrorCategory.SERIAL, err, { title: 'USB Hardware Connection Failure' });
        }
        throw err;
      }
      return false;
    }
  }

  /**
   * Safely disconnects the active serial port and releases read/write locks.
   */
  async disconnect() {
    this.keepReading = false;

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (_) {}
      this.reader = null;
    }

    if (this.writer) {
      try {
        await this.writer.close();
      } catch (_) {}
      this.writer = null;
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch (_) {}
      this.port = null;
    }

    this.portInfo = null;
    this.log('USB Serial connection closed.', 'info');

    if (typeof this.onDisconnect === 'function') {
      this.onDisconnect();
    }
  }

  /**
   * Background incoming serial byte reader stream.
   */
  async startReading() {
    this.keepReading = true;
    while (this.port && this.port.readable && this.keepReading) {
      try {
        this.reader = this.port.readable.getReader();
        const decoder = new TextDecoder();

        while (this.keepReading) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && value.length > 0) {
            const text = decoder.decode(value);
            this.log(`[RX] ${text.trim()}`, 'rx');
          }
        }
      } catch (err) {
        if (this.keepReading) {
          this.log(`Serial read error: ${err.message || err}`, 'warn');
        }
      } finally {
        if (this.reader) {
          try {
            this.reader.releaseLock();
          } catch (_) {}
          this.reader = null;
        }
      }
    }
  }

  /**
   * Computes CRC16-CCITT (Polynomial 0x1021) for transmission packet integrity.
   * @param {Uint8Array} bytes
   * @returns {number}
   */
  computeCRC16(bytes) {
    let crc = 0xFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= (bytes[i] << 8);
      for (let j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      }
      crc &= 0xFFFF;
    }
    return crc;
  }

  /**
   * Transmits raw binary buffer through open serial port.
   * @param {Uint8Array} dataBuffer
   * @returns {Promise<void>}
   */
  async sendRawBuffer(dataBuffer) {
    if (!this.isConnected) {
      throw new Error('No USB controller connected. Please connect via USB first.');
    }

    this.writer = this.port.writable.getWriter();
    try {
      await this.writer.write(dataBuffer);
    } finally {
      this.writer.releaseLock();
      this.writer = null;
    }
  }

  /**
   * Builds and transmits a framed ITMS hardware packet.
   * Packet Structure:
   * [0xAA, 0x55] (Magic Header 2B) | [CMD 1B] | [LEN_HIGH 1B] | [LEN_LOW 1B] | [PAYLOAD N Bytes] | [CRC16_HIGH 1B] | [CRC16_LOW 1B]
   * @param {number} cmd
   * @param {Uint8Array} payload
   */
  async sendFramedPacket(cmd, payload = new Uint8Array(0)) {
    const payloadLen = payload.length;
    const packetLen = 2 + 1 + 2 + payloadLen + 2; // Magic(2) + Cmd(1) + Len(2) + Payload(N) + CRC(2)
    const packet = new Uint8Array(packetLen);

    // 1. Magic Header
    packet[0] = this.MAGIC_HEADER[0];
    packet[1] = this.MAGIC_HEADER[1];

    // 2. Command
    packet[2] = cmd & 0xFF;

    // 3. Payload Length (Big Endian)
    packet[3] = (payloadLen >> 8) & 0xFF;
    packet[4] = payloadLen & 0xFF;

    // 4. Payload Body
    if (payloadLen > 0) {
      packet.set(payload, 5);
    }

    // 5. CRC16 Integrity Checksum over [CMD + LEN + PAYLOAD]
    const crcData = packet.subarray(2, 5 + payloadLen);
    const crc16 = this.computeCRC16(crcData);

    packet[5 + payloadLen] = (crc16 >> 8) & 0xFF;
    packet[6 + payloadLen] = crc16 & 0xFF;

    await this.sendRawBuffer(packet);
  }

  /**
   * Flashes an individual 1-bit column-major LED bitmap directly to the physical display board.
   * @param {Uint8Array} bitmapBytes
   * @param {number} width
   * @param {number} height
   * @param {Object} [options]
   */
  async flashBitmap(bitmapBytes, width, height, options = {}) {
    if (this.isFlashing) throw new Error('Flash operation already in progress.');
    this.isFlashing = true;

    try {
      this.log(`Initiating Live Bitmap Flash (${width}x${height} dots, ${bitmapBytes.length} bytes)...`, 'info');

      // Payload: [WIDTH_H, WIDTH_L, HEIGHT_H, HEIGHT_L, ...BITMAP_BYTES]
      const payload = new Uint8Array(4 + bitmapBytes.length);
      payload[0] = (width >> 8) & 0xFF;
      payload[1] = width & 0xFF;
      payload[2] = (height >> 8) & 0xFF;
      payload[3] = height & 0xFF;
      payload.set(bitmapBytes, 4);

      const chunkSize = options.chunkSize || 256;
      const totalChunks = Math.ceil(payload.length / chunkSize);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(payload.length, start + chunkSize);
        const chunk = payload.subarray(start, end);

        await this.sendFramedPacket(this.CMD_FLASH_BITMAP, chunk);

        const percent = Math.round(((i + 1) / totalChunks) * 100);
        if (typeof this.onProgress === 'function') {
          this.onProgress({ processed: i + 1, total: totalChunks, percent, message: `Streaming bitmap (${percent}%)...` });
        }
        await new Promise(r => setTimeout(r, 10)); // Flow control pacing
      }

      this.log(`Live Bitmap successfully flashed to LED Display (${bitmapBytes.length} bytes transferred)!`, 'success');
      return true;
    } finally {
      this.isFlashing = false;
    }
  }

  /**
   * Streams a full fleet route package binary directly to microcontroller flash / EEPROM.
   * @param {Array<{ path: string, buffer: Uint8Array }>} binaryFiles
   * @param {Object} [options]
   */
  async flashFleetBinaries(binaryFiles, options = {}) {
    if (this.isFlashing) throw new Error('Flash operation already in progress.');
    if (!binaryFiles || binaryFiles.length === 0) throw new Error('No binary files to flash.');

    this.isFlashing = true;
    const totalFiles = binaryFiles.length;
    let completedFiles = 0;
    const totalBytes = binaryFiles.reduce((acc, f) => acc + f.buffer.length, 0);
    let bytesTransferred = 0;

    try {
      this.log(`Starting Master Fleet USB Flash (${totalFiles} files, ${(totalBytes / 1024).toFixed(1)} KB total)...`, 'info');

      // 1. Send Fleet Flash Start Command
      const startPayload = new Uint8Array(4);
      startPayload[0] = (totalFiles >> 8) & 0xFF;
      startPayload[1] = totalFiles & 0xFF;
      startPayload[2] = (totalBytes >> 16) & 0xFF;
      startPayload[3] = (totalBytes & 0xFFFF) >> 8;
      await this.sendFramedPacket(this.CMD_FLASH_FLEET_START, startPayload);

      // 2. Stream Each File with Header
      for (let idx = 0; idx < totalFiles; idx++) {
        const file = binaryFiles[idx];
        const pathBytes = new TextEncoder().encode(file.path);
        const fileData = file.buffer;

        // Chunk Header: [PATH_LEN 1B] | [PATH_STR N Bytes] | [DATA_LEN 2B] | [DATA_BYTES M Bytes]
        const chunkHeader = new Uint8Array(1 + pathBytes.length + 2 + fileData.length);
        chunkHeader[0] = pathBytes.length & 0xFF;
        chunkHeader.set(pathBytes, 1);
        const dataOffset = 1 + pathBytes.length;
        chunkHeader[dataOffset] = (fileData.length >> 8) & 0xFF;
        chunkHeader[dataOffset + 1] = fileData.length & 0xFF;
        chunkHeader.set(fileData, dataOffset + 2);

        await this.sendFramedPacket(this.CMD_FLASH_FLEET_CHUNK, chunkHeader);

        completedFiles++;
        bytesTransferred += fileData.length;

        const percent = Math.round((bytesTransferred / (totalBytes || 1)) * 100);
        if (typeof this.onProgress === 'function') {
          this.onProgress({
            processed: completedFiles,
            total: totalFiles,
            percent,
            bytesTransferred,
            totalBytes,
            currentFile: file.path,
            message: `Flashing [${idx + 1}/${totalFiles}] ${file.path} (${percent}%)...`
          });
        }
        await new Promise(r => setTimeout(r, 15));
      }

      // 3. Send Fleet Flash End Command
      await this.sendFramedPacket(this.CMD_FLASH_FLEET_END);

      this.log(`Master Fleet Firmware Flash Complete (${totalFiles} files, ${(totalBytes / 1024).toFixed(1)} KB transferred)!`, 'success');
      return true;
    } finally {
      this.isFlashing = false;
    }
  }
}

// Global & Window Namespace Export
if (typeof window !== 'undefined') {
  window.ITMS = window.ITMS || {};
  window.ITMS.WebSerialFlasher = WebSerialFlasher;
  window.WebSerialFlasher = WebSerialFlasher;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebSerialFlasher;
}
