/**
 * Master Hybrid Dynamic & Transit Indic Transliteration Engine for Telugu & Hindi
 * Dedicated to Public Transit Bus Routes, Metro Corridors, Intermediary Stops & Localities.
 * Features intelligent morphological root/affix deconstruction, anusvara/vathulu binding,
 * and an advanced dynamic Akshara phoneme parser for authentic native local spelling.
 */
class IndicTransliterationEngine {
  constructor() {
    const globalDict = (typeof window !== 'undefined' && (window.ITMS_TRANSLIT_DICTIONARY || (window.ITMS && window.ITMS.TranslitDictionary)))
      || (typeof global !== 'undefined' && global.ITMS_TRANSLIT_DICTIONARY)
      || ((typeof require !== 'undefined') ? (() => { try { return require('./data/translit-dictionary.js').ITMS_TRANSLIT_DICTIONARY; } catch (_) { return {}; } })() : {})
      || {};

    const globalSpeller = (typeof window !== 'undefined' && (window.ITMS_LETTER_SPELLER || (window.ITMS && window.ITMS.LetterSpeller)))
      || (typeof global !== 'undefined' && global.ITMS_LETTER_SPELLER)
      || ((typeof require !== 'undefined') ? (() => { try { return require('./data/translit-dictionary.js').ITMS_LETTER_SPELLER; } catch (_) { return null; } })() : null)
      || {
        'a': 'ఏ', 'b': 'బీ', 'c': 'సీ', 'd': 'డీ', 'e': 'ఈ', 'f': 'ఎఫ్',
        'g': 'జీ', 'h': 'హెచ్', 'i': 'ఐ', 'j': 'జే', 'k': 'కే', 'l': 'ఎల్',
        'm': 'ఎం', 'n': 'ఎన్', 'o': 'ఓ', 'p': 'పీ', 'q': 'క్యూ', 'r': 'ఆర్',
        's': 'ఎస్', 't': 'టీ', 'u': 'యూ', 'v': 'వి', 'w': 'డబ్ల్యూ',
        'x': 'ఎక్స్', 'y': 'వై', 'z': 'జెడ్'
      };

    const globalSuffixes = (typeof window !== 'undefined' && (window.ITMS_SUFFIXES || (window.ITMS && window.ITMS.Suffixes)))
      || (typeof global !== 'undefined' && global.ITMS_SUFFIXES)
      || ((typeof require !== 'undefined') ? (() => { try { return require('./data/translit-dictionary.js').ITMS_SUFFIXES; } catch (_) { return []; } })() : [])
      || [];

    const globalPrefixes = (typeof window !== 'undefined' && (window.ITMS_PREFIXES || (window.ITMS && window.ITMS.Prefixes)))
      || (typeof global !== 'undefined' && global.ITMS_PREFIXES)
      || ((typeof require !== 'undefined') ? (() => { try { return require('./data/translit-dictionary.js').ITMS_PREFIXES; } catch (_) { return []; } })() : [])
      || [];

    const globalCmu = (typeof window !== 'undefined' && (window.ITMS_CMU_LEXICON || (window.ITMS && window.ITMS.CmuLexicon)))
      || (typeof global !== 'undefined' && global.ITMS_CMU_LEXICON)
      || ((typeof require !== 'undefined') ? (() => { try { return require('./data/translit-dictionary.js').ITMS_CMU_LEXICON; } catch (_) { return {}; } })() : {})
      || {};

    /** @type {Record<string, string>} */
    this.letterSpeller = Object.assign({}, globalSpeller);

    /** @type {Record<string, string>} */
    this.dictionary = Object.assign({}, globalDict);

    /** @type {Array<{en: RegExp, te: string}>} */
    this.suffixes = globalSuffixes.slice();

    /** @type {Array<{en: RegExp, te: string}>} */
    this.prefixes = globalPrefixes.slice();

    /** @type {Record<string, string[]>} */
    this.cmuLexicon = Object.assign({}, globalCmu);

    this.normalizedDict = {};
    this.buildNormalizedDictionary();
  }

  /**
   * Registers additional dictionary entries dynamically at runtime.
   * @param {Record<string, string>} entries
   */
  addDictionaryEntries(entries) {
    if (entries && typeof entries === 'object') {
      Object.assign(this.dictionary, entries);
      this.buildNormalizedDictionary();
    }
  }

  buildNormalizedDictionary() {
    this.normalizedDict = {};
    for (const k in this.dictionary) {
      const normKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      this.normalizedDict[normKey] = this.dictionary[k];
    }
  }

  /**
   * Transliterate English text to natural, accurate native local Telugu script
   * @param {string} englishText
   * @returns {string}
   */
  transliterate(englishText) {
    if (!englishText || typeof englishText !== 'string') return '';
    const cleanStr = englishText.trim();
    if (!cleanStr) return '';

    // 1. Direct Exact Match in Dictionary
    const lowerFull = cleanStr.toLowerCase();
    if (this.dictionary[lowerFull]) {
      return this.dictionary[lowerFull];
    }

    // 2. Normalized Direct Match (if purely alphanumeric and not pure digits)
    const normFull = lowerFull.replace(/[^a-z0-9]/g, '');
    if (this.normalizedDict[normFull] && !/^\d+$/.test(normFull)) {
      return this.normalizedDict[normFull];
    }

    // 3. Multi-word phrase tokenization with forward-matching
    const words = cleanStr.split(/(\s+|[-/&,():.#]+)/);
    const resultTokens = [];

    let i = 0;
    while (i < words.length) {
      const token = words[i];
      if (!token) { i++; continue; }

      // Keep punctuation and spaces as is
      if (/^(\s+|[-/&,():.#]+)$/.test(token)) {
        resultTokens.push(token);
        i++;
        continue;
      }

      // Check 4-word / 4-token phrase match
      if (i + 6 < words.length) {
        const phrase4WithSpace = (words[i] + ' ' + words[i+2] + ' ' + words[i+4] + ' ' + words[i+6]).toLowerCase();
        const rawPhrase4 = (words[i] + words[i+1] + words[i+2] + words[i+3] + words[i+4] + words[i+5] + words[i+6]).toLowerCase();
        const normPhrase4 = rawPhrase4.replace(/[^a-z0-9]/g, '');
        if (this.dictionary[phrase4WithSpace] || this.dictionary[rawPhrase4] || this.normalizedDict[normPhrase4]) {
          resultTokens.push(this.dictionary[phrase4WithSpace] || this.dictionary[rawPhrase4] || this.normalizedDict[normPhrase4]);
          i += 7;
          continue;
        }
      }

      // Check 3-word / 3-token phrase match
      if (i + 4 < words.length) {
        const rawPhrase3 = (words[i] + words[i+1] + words[i+2] + words[i+3] + words[i+4]).toLowerCase();
        const normPhrase3 = rawPhrase3.replace(/[^a-z0-9]/g, '');
        const phrase3WithSpace = (words[i] + ' ' + words[i+2] + ' ' + words[i+4]).toLowerCase();
        if (this.dictionary[phrase3WithSpace] || this.dictionary[rawPhrase3] || this.normalizedDict[normPhrase3]) {
          resultTokens.push(this.dictionary[phrase3WithSpace] || this.dictionary[rawPhrase3] || this.normalizedDict[normPhrase3]);
          i += 5;
          continue;
        }
      }

      // Check 2-word / 2-token phrase match (e.g. non-stop, hitech city, ring road, x roads, rahmat nagar)
      if (i + 2 < words.length) {
        const rawPhrase2 = (words[i] + words[i+1] + words[i+2]).toLowerCase();
        const normPhrase2 = rawPhrase2.replace(/[^a-z0-9]/g, '');
        const phrase2WithSpace = (words[i] + ' ' + words[i+2]).toLowerCase();
        if (this.dictionary[phrase2WithSpace] || this.dictionary[rawPhrase2] || this.normalizedDict[normPhrase2]) {
          resultTokens.push(this.dictionary[phrase2WithSpace] || this.dictionary[rawPhrase2] || this.normalizedDict[normPhrase2]);
          i += 3;
          continue;
        }
      }

      resultTokens.push(this.transliterateWord(token));
      i++;
    }

    return resultTokens.join('');
  }

  /**
   * Transliterate a single dynamic word
   * @param {string} word
   * @returns {string}
   */
  transliterateWord(word) {
    if (!word) return '';

    // If word is pure digits (e.g. 123, 216), preserve verbatim
    if (/^\d+$/.test(word)) {
      return word;
    }

    // If word starts or ends with digits (e.g. 5K, 1A, 100Feet, 6Number), split digits and transliterate
    if (/\d/.test(word)) {
      const parts = word.split(/(\d+)/);
      return parts.map(p => {
        if (/^\d+$/.test(p)) return p;
        return this.transliterateWord(p);
      }).join('');
    }

    const rawClean = word.toLowerCase().replace(/[^a-z0-9]/gi, '');
    if (!rawClean) return word;

    return this.translateWord(word);
  }

  /**
   * Translate a single word with path tracking (exceptions / dictionary / fallback)
   * @param {string} word
   * @param {boolean} [debug=false]
   * @returns {string}
   */
  translateWord(word, debug = false) {
    if (!word) return '';

    // If word is pure digits (e.g. 123, 216), preserve verbatim
    if (/^\d+$/.test(word)) {
      return word;
    }

    // If word contains digits and letters (e.g. 5K, 1A, 100Feet), split and translate
    if (/\d/.test(word)) {
      const parts = word.split(/(\d+)/);
      return parts.map(p => {
        if (/^\d+$/.test(p)) return p;
        return this.translateWord(p, debug);
      }).join('');
    }

    const rawClean = word.toLowerCase().replace(/[^a-z0-9]/gi, '');
    if (!rawClean) return word;

    let path = 'fallback';
    let output = '';

    // 1. Exceptions / Master Dictionary Path
    if (this.dictionary[rawClean]) {
      path = 'exceptions';
      output = this.dictionary[rawClean];
    } else if (this.normalizedDict[rawClean]) {
      path = 'exceptions';
      output = this.normalizedDict[rawClean];
    } else if (!/[aeiouy]/i.test(rawClean) && rawClean.length >= 2 && rawClean.length <= 7) {
      path = 'exceptions';
      output = this.spellAcronym(rawClean);
    } else {
      // 2. Full Phoneme Dictionary & ARPAbet G2P Path
      const phonemes = this.lookupPhonemes(rawClean);
      if (phonemes && phonemes.length > 0) {
        path = 'dictionary';
        output = this.phonemesToTelugu(phonemes);
      } else {
        // Dynamic Prefix Decomposition
        let affixMatched = false;
        for (const p of this.prefixes) {
          if (p.en.test(rawClean)) {
            const match = rawClean.match(p.en)[0];
            const stem = rawClean.slice(match.length);
            if (stem && stem.length >= 2) {
              const translitStem = this.dictionary[stem] || this.translateWord(stem);
              path = 'exceptions';
              output = p.te + (translitStem.startsWith('ా') || translitStem.startsWith('ి') || translitStem.startsWith('ీ') || translitStem.startsWith('ు') || translitStem.startsWith('ూ') || translitStem.startsWith('ె') || translitStem.startsWith('ే') || translitStem.startsWith('ొ') || translitStem.startsWith('ో') || translitStem.startsWith('ౌ') || translitStem.startsWith('ై') ? translitStem.slice(1) : translitStem);
              affixMatched = true;
              break;
            }
          }
        }

        // Dynamic Suffix Decomposition
        if (!affixMatched) {
          for (const rule of this.suffixes) {
            if (rule.en.test(rawClean) && rawClean.length > 4) {
              const stem = rawClean.replace(rule.en, '');
              if (stem && stem.length >= 2) {
                let translitStem = '';
                if (stem.endsWith('am') || stem.endsWith('um')) {
                  const stemBase = stem.slice(0, -1);
                  translitStem = (this.dictionary[stemBase] || this.translateWord(stemBase)) + 'ం';
                } else {
                  translitStem = this.dictionary[stem] || this.translateWord(stem);
                }
                if (translitStem.endsWith('్')) translitStem = translitStem.slice(0, -1);
                if (rule.te.startsWith('ా') || rule.te.startsWith('ి') || rule.te.startsWith('ు') || rule.te.startsWith('ె') || rule.te.startsWith('ొ') || rule.te.startsWith('ో') || rule.te.startsWith('ూ') || rule.te.startsWith('ే')) {
                  if (translitStem.endsWith('ా') || translitStem.endsWith('ి') || translitStem.endsWith('ు') || translitStem.endsWith('ె') || translitStem.endsWith('ొ') || translitStem.endsWith('ో') || translitStem.endsWith('ూ') || translitStem.endsWith('ే')) {
                    translitStem = translitStem.slice(0, -1);
                  }
                }
                path = 'exceptions';
                output = translitStem + rule.te;
                affixMatched = true;
                break;
              }
            }
          }
        }

        // 3. Fallback Path (Out-of-vocabulary / typo)
        if (!affixMatched) {
          path = 'fallback';
          output = this.parsePhonetic(rawClean);
        }
      }
    }

    this.lastTranslationPath = path;

    if (debug || this.debugMode) {
      console.log(`[Translit Engine] "${word}" => "${output}" via path: [${path}]`);
    }

    return output;
  }

  /**
   * Lookup or synthesize ARPAbet phoneme sequence for an English word
   * @param {string} word
   * @returns {string[]|null}
   */
  lookupPhonemes(word) {
    if (!word) return null;
    const w = word.toLowerCase().trim();

    // Direct / Bundled CMU ARPAbet Phoneme Lexicon
    if (!this.cmuLexicon) {
      this.initPhonemeLexicon();
    }

    if (this.cmuLexicon[w]) {
      return this.cmuLexicon[w];
    }

    // High-Precision Rule-Based ARPAbet G2P Synthesizer for English Words
    return this.synthesizePhonemes(w);
  }

  /**
   * Convert ARPAbet phonemes to natural Telugu script
   * @param {string[]} phonemes
   * @returns {string}
   */
  phonemesToTelugu(phonemes) {
    if (!phonemes || !phonemes.length) return '';

    const VOWEL_INITIAL = {
      'AA': 'ఆ', 'AE': 'యా', 'AH': 'అ', 'AO': 'ఆ', 'AW': 'ఔ', 'AY': 'ఐ',
      'EH': 'ఎ', 'ER': 'అర్', 'EY': 'ఏ', 'IH': 'ఇ', 'IY': 'ఈ',
      'OW': 'ఓ', 'OY': 'ఆయ్', 'UH': 'ఉ', 'UW': 'ఊ'
    };

    const VOWEL_MATRA = {
      'AA': 'ా', 'AE': '్యా', 'AH': '', 'AO': 'ో', 'AW': 'ౌ', 'AY': 'ై',
      'EH': 'ె', 'ER': 'ర్', 'EY': 'ే', 'IH': 'ి', 'IY': 'ీ',
      'OW': 'ొ', 'OY': 'ాయి', 'UH': 'ు', 'UW': 'ూ'
    };

    const CONSONANTS = {
      'B': 'బ', 'CH': 'చ', 'D': 'డ', 'DH': 'ద', 'F': 'ఫ', 'G': 'గ',
      'HH': 'హ', 'JH': 'జ', 'K': 'క', 'L': 'ల', 'M': 'మ', 'N': 'న',
      'NG': 'ంగ్', 'P': 'ప', 'R': 'ర', 'S': 'స', 'SH': 'ష', 'T': 'ట',
      'TH': 'త', 'V': 'వ', 'W': 'వ', 'Y': 'య', 'Z': 'జ', 'ZH': 'జ'
    };

    let result = '';
    let prevWasConsonant = false;

    for (let idx = 0; idx < phonemes.length; idx++) {
      const raw = phonemes[idx].replace(/\d+/g, '').toUpperCase();
      const nextRaw = (idx + 1 < phonemes.length) ? phonemes[idx + 1].replace(/\d+/g, '').toUpperCase() : '';

      // Anusvara optimization: N before dental/retroflex consonant (D, T, JH, CH, G) becomes Anusvara 'ం'
      if (raw === 'N' && nextRaw && ['D', 'T', 'JH', 'CH', 'G'].includes(nextRaw)) {
        result += 'ం';
        prevWasConsonant = false;
        continue;
      }

      if (VOWEL_INITIAL[raw]) {
        if (prevWasConsonant) {
          if (raw === 'AE') {
            result += '్యా';
          } else if (raw === 'ER') {
            result += 'ర్';
          } else if (raw === 'EH' && idx === phonemes.length - 2 && phonemes[idx + 1].startsWith('S')) {
            result += 'ె';
          } else if (raw === 'AO' && idx === 1 && phonemes[0].replace(/\d+/g, '').toUpperCase() === 'AO') {
            result += 'ా';
          } else {
            result += VOWEL_MATRA[raw];
          }
          prevWasConsonant = false;
        } else {
          result += VOWEL_INITIAL[raw];
        }
      } else if (CONSONANTS[raw]) {
        if (prevWasConsonant) {
          if (phonemes[idx - 1].replace(/\d+/g, '').toUpperCase() === 'CH' && raw === 'T') {
            result += '్డ';
          } else {
            result += '్' + CONSONANTS[raw];
          }
        } else {
          result += CONSONANTS[raw];
        }
        prevWasConsonant = (raw !== 'NG');
      }
    }

    if (prevWasConsonant && !result.endsWith('్') && !result.endsWith('ంగ్') && !result.endsWith('ం')) {
      result += '్';
    }

    return result;
  }

  /**
   * Rule-based ARPAbet G2P Synthesizer
   * @param {string} w
   * @returns {string[]|null}
   */
  synthesizePhonemes(w) {
    if (!w || !/[aeiouy]/.test(w)) return null;

    if (w.endsWith('ed')) {
      const stem = w.slice(0, -2);
      if (stem === 'order') return ['AO', 'R', 'D', 'ER', 'D'];
      if (stem === 'deliver') return ['D', 'EH', 'L', 'IH', 'V', 'ER', 'D'];
      if (stem === 'confirm') return ['K', 'AH', 'N', 'F', 'ER', 'M', 'D'];
      if (stem === 'return') return ['R', 'IH', 'T', 'ER', 'N', 'D'];
      if (stem === 'cancel' || stem === 'cancell') return ['K', 'AE', 'N', 'S', 'IH', 'L', 'D'];
      if (stem === 'fail') return ['F', 'EH', 'Y', 'L', 'D'];
      if (stem === 'dispatch') return ['D', 'IH', 'S', 'P', 'AA', 'CH', 'T'];
      if (stem === 'track') return ['T', 'R', 'AA', 'K', 'T'];
      if (stem === 'pack') return ['P', 'AE', 'K', 'T'];
      if (stem === 'ship' || stem === 'shipp') return ['SH', 'IH', 'P', 'T'];
      if (stem === 'process') return ['P', 'R', 'AA', 'S', 'EH', 'S', 'T'];
    }

    if (w.endsWith('ing')) {
      const stem = w.slice(0, -3);
      if (stem === 'process') return ['P', 'R', 'AA', 'S', 'EH', 'S', 'IH', 'NG'];
      if (stem === 'track') return ['T', 'R', 'AA', 'K', 'IH', 'NG'];
      if (stem === 'pend') return ['P', 'EH', 'N', 'D', 'IH', 'NG'];
      if (stem === 'rat') return ['R', 'EY', 'T', 'IH', 'NG'];
      if (stem === 'charg') return ['CH', 'AA', 'R', 'JH', 'IH', 'NG'];
      if (stem === 'park') return ['P', 'AA', 'R', 'K', 'IH', 'NG'];
      if (stem === 'train') return ['T', 'R', 'EY', 'N', 'IH', 'NG'];
      if (stem === 'meet') return ['M', 'IY', 'T', 'IH', 'NG'];
    }

    if (w.endsWith('ment')) {
      const stem = w.slice(0, -4);
      if (stem === 'ship') return ['SH', 'IH', 'P', 'M', 'EH', 'N', 'T'];
      if (stem === 'pay') return ['P', 'EY', 'M', 'EH', 'N', 'T'];
      if (stem === 'state') return ['S', 'T', 'EY', 'T', 'M', 'EH', 'N', 'T'];
      if (stem === 'apart') return ['AH', 'P', 'AA', 'R', 'T', 'M', 'EH', 'N', 'T'];
    }

    if (w.endsWith('tion') || w.endsWith('sion')) {
      const stem = w.slice(0, -4);
      if (stem === 'loca') return ['L', 'OW', 'K', 'EY', 'SH', 'AH', 'N'];
      if (stem === 'destina') return ['D', 'EH', 'S', 'T', 'AH', 'N', 'EY', 'SH', 'AH', 'N'];
      if (stem === 'applica') return ['AE', 'P', 'L', 'AH', 'K', 'EY', 'SH', 'AH', 'N'];
      if (stem === 'registra') return ['R', 'EH', 'JH', 'AH', 'S', 'T', 'R', 'EY', 'SH', 'AH', 'N'];
    }

    return null;
  }

  lookupPhonemes(w) {
    if (!w) return null;
    const lower = w.toLowerCase();
    if (this.cmuLexicon[lower]) return this.cmuLexicon[lower];
    return this.synthesizePhonemes(lower);
  }

  spellAcronym(str) {
    let out = '';
    for (let char of str) {
      if (this.letterSpeller[char]) {
        out += this.letterSpeller[char];
      }
    }
    return out;
  }

  parsePhonetic(str) {
    let s = str;
    let i = 0;
    let out = '';
    let isStart = true;

    while (i < s.length) {
      // 1. Initial Independent Vowels & Diphthongs
      if (isStart) {
        if (s.substring(i, i + 4) === 'eigh' || s.substring(i, i + 4) === 'aigh') { out += 'ఐ'; i += 4; isStart = false; continue; }
        if (s.substring(i, i + 3) === 'air') { out += 'ఎయిర్'; i += 3; isStart = false; continue; }
        if (s.substring(i, i + 3) === 'igh') { out += 'ఐ'; i += 3; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'aa') { out += 'ఆ'; i += 2; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'ee' || s.substring(i, i + 2) === 'ea') { out += 'ఈ'; i += 2; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'oo' || s.substring(i, i + 2) === 'uu') { out += 'ఊ'; i += 2; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'ou' || s.substring(i, i + 2) === 'au' || s.substring(i, i + 2) === 'aw') { out += 'ఔ'; i += 2; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'ai' || s.substring(i, i + 2) === 'ay') { out += 'ఐ'; i += 2; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'ow') { out += 'ఓ'; i += 2; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'ae') { out += 'ఏ'; i += 2; isStart = false; continue; }
        if (s[i] === 'a') {
          out += 'అ'; i += 1; isStart = false; continue;
        }
        if (s[i] === 'i') { out += 'ఇ'; i += 1; isStart = false; continue; }
        if (s[i] === 'u') { out += 'ఉ'; i += 1; isStart = false; continue; }
        if (s[i] === 'e') { out += 'ఎ'; i += 1; isStart = false; continue; }
        if (s[i] === 'o') { out += 'ఒ'; i += 1; isStart = false; continue; }
      }

      // Check word-ending -am / -um / -gam (Anusvara)
      if (i + 3 === s.length && (s.substring(i, i + 3) === 'gam')) {
        out += 'గం';
        i += 3;
        break;
      }
      if (i + 2 === s.length && (s.substring(i, i + 2) === 'am' || s.substring(i, i + 2) === 'um')) {
        out += 'ం';
        i += 2;
        break;
      }

      // 2. Multi-character Consonants & Clusters
      let cons = '';
      let len = 0;

      // 7-character cluster
      if (i + 7 <= s.length) {
        const c7 = s.substring(i, i + 7);
        if (c7 === 'sandhya') { cons = 'సంధ్య'; len = 7; }
        else if (c7 === 'krishna') { cons = 'కృష్ణ'; len = 7; }
      }

      // 6-character cluster
      if (!cons && i + 6 <= s.length) {
        const c6 = s.substring(i, i + 6);
        if (c6 === 'krishn') { cons = 'కృష్ణ'; len = 6; }
        else if (c6 === 'sandhy') { cons = 'సంధ్య'; len = 6; }
        else if (c6 === 'satish') { cons = 'సతీష్'; len = 6; }
        else if (c6 === 'harish') { cons = 'హరీష్'; len = 6; }
        else if (c6 === 'girish') { cons = 'గిరీష్'; len = 6; }
        else if (c6 === 'manish') { cons = 'మనీష్'; len = 6; }
        else if (c6 === 'ashish') { cons = 'ఆశిష్'; len = 6; }
        else if (c6 === 'rajesh') { cons = 'రాజేష్'; len = 6; }
        else if (c6 === 'ganesh') { cons = 'గణేష్'; len = 6; }
        else if (c6 === 'dinesh') { cons = 'దినేష్'; len = 6; }
        else if (c6 === 'naresh') { cons = 'నరేష్'; len = 6; }
        else if (c6 === 'suresh') { cons = 'సురేష్'; len = 6; }
        else if (c6 === 'ramesh') { cons = 'రమేష్'; len = 6; }
        else if (c6 === 'mahesh') { cons = 'మహేష్'; len = 6; }
        else if (c6 === 'lokesh') { cons = 'లోకేష్'; len = 6; }
        else if (c6 === 'mukesh') { cons = 'ముఖేష్'; len = 6; }
        else if (c6 === 'rakesh') { cons = 'రాకేష్'; len = 6; }
      }

      // 5-character cluster
      if (!cons && i + 5 <= s.length) {
        const c5 = s.substring(i, i + 5);
        if (c5 === 'kshmi') { cons = 'క్ష్మి'; len = 5; }
        else if (c5 === 'shnam') { cons = 'ష్ణం'; len = 5; }
        else if (c5 === 'shree') { cons = 'శ్రీ'; len = 5; }
        else if (c5 === 'swami') { cons = 'స్వామి'; len = 5; }
        else if (c5 === 'radha') { cons = 'రాధా'; len = 5; }
        else if (c5 === 'kavya') { cons = 'కావ్య'; len = 5; }
        else if (c5 === 'divya') { cons = 'దివ్య'; len = 5; }
        else if (c5 === 'vidya') { cons = 'విద్య'; len = 5; }
        else if (c5 === 'bhavya') { cons = 'భవ్య'; len = 5; }
        else if (c5 === 'navya') { cons = 'నవ్య'; len = 5; }
        else if (c5 === 'ramya') { cons = 'రమ్య'; len = 5; }
      }

      // 4-character clusters
      if (!cons && i + 4 <= s.length) {
        const c4 = s.substring(i, i + 4);
        if (c4 === 'thrw') { cons = 'త్ర్వ'; len = 4; }
        else if (c4 === 'tion' || c4 === 'sion') { cons = 'షన్'; len = 4; }
        else if (c4 === 'shna') { cons = 'ష్ణ'; len = 4; }
        else if (c4 === 'shnu') { cons = 'ష్ణు'; len = 4; }
        else if (c4 === 'shni') { cons = 'ష్ణి'; len = 4; }
        else if (c4 === 'ksha') { cons = 'క్ష'; len = 4; }
        else if (c4 === 'kshy') { cons = 'క్ష్య'; len = 4; }
        else if (c4 === 'shwa' || c4 === 'shva') { cons = 'శ్వ'; len = 4; }
        else if (c4 === 'shra') { cons = 'శ్ర'; len = 4; }
        else if (c4 === 'stra') { cons = 'స్ట్ర'; len = 4; }
        else if (c4 === 'chou') { cons = 'చౌ'; len = 4; }
        else if (c4 === 'moul') { cons = 'మౌల్'; len = 4; }
        else if (c4 === 'gout' || c4 === 'gaut') { cons = 'గౌత్'; len = 4; }
        else if (c4 === 'yana') { cons = 'యణ'; len = 4; }
        else if (c4 === 'shri') { cons = 'శ్రీ'; len = 4; }
        else if (c4 === 'shad') { cons = 'షాద్'; len = 4; }
        else if (c4 === 'dhya') { cons = 'ధ్య'; len = 4; }
        else if (c4 === 'bhya') { cons = 'భ్య'; len = 4; }
        else if (c4 === 'shya') { cons = 'శ్య'; len = 4; }
        else if (c4 === 'thya') { cons = 'త్య'; len = 4; }
        else if (c4 === 'swam') { cons = 'స్వామ్'; len = 4; }
        else if (c4 === 'dwar') { cons = 'ద్వార్'; len = 4; }
        else if (c4 === 'jnan' || c4 === 'gyan') { cons = 'జ్ఞాన్'; len = 4; }
      }

      // 3-character clusters
      if (!cons && i + 3 <= s.length) {
        const c3 = s.substring(i, i + 3);
        const nextIsVowel = i + 3 < s.length && /[aeiouy]/.test(s[i + 3]);

        if (c3 === 'sri') { cons = 'శ్రీ'; len = 3; }
        else if (c3 === 'chr') { cons = 'చ్ర'; len = 3; }
        else if (c3 === 'shr') { cons = 'శ్ర'; len = 3; }
        else if (c3 === 'shw' || c3 === 'shv') { cons = 'శ్వ'; len = 3; }
        else if (c3 === 'shm') { cons = nextIsVowel ? 'ష్మ' : 'ష్మ్'; len = 3; }
        else if (c3 === 'shn') { cons = nextIsVowel ? 'ష్ణ' : 'ష్ణ్'; len = 3; }
        else if (c3 === 'thr') { cons = 'త్ర'; len = 3; }
        else if (c3 === 'dhr') { cons = 'ధ్ర'; len = 3; }
        else if (c3 === 'khr') { cons = 'ఖ్ర'; len = 3; }
        else if (c3 === 'phr') { cons = 'ఫ్ర'; len = 3; }
        else if (c3 === 'bhr') { cons = 'భ్ర'; len = 3; }
        else if (c3 === 'ghr') { cons = 'ఘ్ర'; len = 3; }
        else if (c3 === 'str') { cons = 'స్ట్ర'; len = 3; }
        else if (c3 === 'spr') { cons = 'స్ప్ర'; len = 3; }
        else if (c3 === 'skr' || c3 === 'scr') { cons = 'స్క్ర'; len = 3; }
        else if (c3 === 'squ') { cons = 'స్క్వ'; len = 3; }
        else if (c3 === 'spl') { cons = 'స్ప్ల'; len = 3; }
        else if (c3 === 'tch') { cons = 'చ్'; len = 3; }
        else if (c3 === 'dya') { cons = 'ద్య'; len = 3; }
        else if (c3 === 'tya') { cons = 'త్య'; len = 3; }
        else if (c3 === 'thy') { cons = 'త్య'; len = 3; }
        else if (c3 === 'nya') { cons = 'న్య'; len = 3; }
        else if (c3 === 'rya') { cons = 'ర్య'; len = 3; }
        else if (c3 === 'pya') { cons = 'ప్య'; len = 3; }
        else if (c3 === 'bya') { cons = 'బ్య'; len = 3; }
        else if (c3 === 'mya') { cons = 'మ్య'; len = 3; }
        else if (c3 === 'vya') { cons = 'వ్య'; len = 3; }
        else if (c3 === 'lya') { cons = 'ల్య'; len = 3; }
        else if (c3 === 'sya') { cons = 'స్య'; len = 3; }
        else if (c3 === 'kya') { cons = 'క్య'; len = 3; }
        else if (c3 === 'gya') { cons = 'గ్య'; len = 3; }
        else if (c3 === 'hya') { cons = 'హ్య'; len = 3; }
        else if (c3 === 'pna') { cons = 'ప్న'; len = 3; }
        else if (c3 === 'tna') { cons = 'త్న'; len = 3; }
        else if (c3 === 'dna') { cons = 'ద్న'; len = 3; }
        else if (c3 === 'gna') { cons = 'గ్న'; len = 3; }
        else if (c3 === 'kna') { cons = 'క్న'; len = 3; }
        else if (c3 === 'mna') { cons = 'మ్న'; len = 3; }
        else if (c3 === 'ndr') { cons = 'ంద్ర'; len = 3; }
        else if (c3 === 'ndh') { cons = nextIsVowel ? 'ంధ' : 'ంధ్'; len = 3; }
        else if (c3 === 'nth') { cons = nextIsVowel ? 'ంత' : 'ంత్'; len = 3; }
        else if (c3 === 'nch') { cons = nextIsVowel ? 'ంచ' : 'ంచ్'; len = 3; }
        else if (c3 === 'tth' || c3 === 'thth') { cons = 'త్త'; len = 3; }
        else if (c3 === 'ddh') { cons = 'ద్ధ'; len = 3; }
        else if (c3 === 'cch' || c3 === 'chch') { cons = 'చ్చ'; len = 3; }
        else if (c3 === 'ksh') { cons = 'క్ష'; len = 3; }
        else if (c3 === 'kri' || c3 === 'kru') { cons = 'కృష్'; len = 3; }
        else if (c3 === 'dhy') { cons = 'ధ్య'; len = 3; }
        else if (c3 === 'bhy') { cons = 'భ్య'; len = 3; }
        else if (c3 === 'tla') { cons = 'ట్ల'; len = 3; }
        else if (c3 === 'dla') { cons = 'డ్ల'; len = 3; }
        else if (c3 === 'rla') { cons = 'ర్ల'; len = 3; }
        else if (c3 === 'mma') { cons = 'మ్మ'; len = 3; }
        else if (c3 === 'ppa') { cons = 'ప్ప'; len = 3; }
        else if (c3 === 'nna') { cons = 'న్న'; len = 3; }
        else if (c3 === 'yya') { cons = 'య్య'; len = 3; }
        else if (c3 === 'lla') { cons = 'ల్ల'; len = 3; }
        else if (c3 === 'vva') { cons = 'వ్వ'; len = 3; }
        else if (c3 === 'ssa') { cons = 'స్స'; len = 3; }
        else if (c3 === 'sai') { cons = 'సాయి'; len = 3; }
      }

      // 2-character clusters
      if (!cons && i + 2 <= s.length) {
        const c2 = s.substring(i, i + 2);
        const nextIsVowel = i + 2 < s.length && /[aeiouy]/.test(s[i + 2]);

        if (c2 === 'hm') { cons = nextIsVowel ? 'హ్మ' : 'హ్మ్'; len = 2; }
        else if (c2 === 'hn') { cons = nextIsVowel ? 'హ్న' : 'హ్న్'; len = 2; }
        else if (c2 === 'hl') { cons = nextIsVowel ? 'హ్ల' : 'హ్ల్'; len = 2; }
        else if (c2 === 'hr') { cons = nextIsVowel ? 'హ్ర' : 'హ్ర'; len = 2; }
        else if (c2 === 'hv' || c2 === 'hw') { cons = nextIsVowel ? 'హ్వ' : 'హ్వ్'; len = 2; }
        else if (c2 === 'kt') { cons = nextIsVowel ? 'క్త' : 'క్త్'; len = 2; }
        else if (c2 === 'pt') { cons = nextIsVowel ? 'ప్త' : 'ప్త్'; len = 2; }
        else if (c2 === 'tm') { cons = nextIsVowel ? 'త్మ' : 'త్మ్'; len = 2; }
        else if (c2 === 'tn') { cons = nextIsVowel ? 'త్న' : 'త్న్'; len = 2; }
        else if (c2 === 'dm') { cons = nextIsVowel ? 'ద్మ' : 'ద్మ్'; len = 2; }
        else if (c2 === 'dv' || c2 === 'dw') { cons = nextIsVowel ? 'ద్వ' : 'ద్వ్'; len = 2; }
        else if (c2 === 'gn') { cons = nextIsVowel ? 'గ్న' : 'గ్న్'; len = 2; }
        else if (c2 === 'gm') { cons = nextIsVowel ? 'గ్మ' : 'గ్మ్'; len = 2; }
        else if (c2 === 'gy' || c2 === 'jn') { cons = nextIsVowel ? 'జ్ఞ' : 'జ్ఞ్'; len = 2; }
        else if (c2 === 'sm') { cons = nextIsVowel ? 'స్మ' : 'స్మ్'; len = 2; }
        else if (c2 === 'sn') { cons = nextIsVowel ? 'స్న' : 'స్న్'; len = 2; }
        else if (c2 === 'sp') { cons = nextIsVowel ? 'స్ప' : 'స్ప్'; len = 2; }
        else if (c2 === 'sy') { cons = nextIsVowel ? 'స్య' : 'స్య్'; len = 2; }
        else if (c2 === 'ty') { cons = nextIsVowel ? 'త్య' : 'త్య్'; len = 2; }
        else if (c2 === 'dy') { cons = nextIsVowel ? 'ద్య' : 'ద్య్'; len = 2; }
        else if (c2 === 'py') { cons = nextIsVowel ? 'ప్య' : 'ప్య్'; len = 2; }
        else if (c2 === 'by') { cons = nextIsVowel ? 'బ్య' : 'బ్య్'; len = 2; }
        else if (c2 === 'my') { cons = nextIsVowel ? 'మ్య' : 'మ్య్'; len = 2; }
        else if (c2 === 'ry') { cons = nextIsVowel ? 'ర్య' : 'ర్య్'; len = 2; }
        else if (c2 === 'ly') { cons = nextIsVowel ? 'ల్య' : 'ల్య్'; len = 2; }
        else if (c2 === 'vy') { cons = nextIsVowel ? 'వ్య' : 'వ్య్'; len = 2; }
        else if (c2 === 'bd') { cons = nextIsVowel ? 'బ్ద' : 'బ్ద్'; len = 2; }
        else if (c2 === 'lk') { cons = nextIsVowel ? 'ల్క' : 'ల్క్'; len = 2; }
        else if (c2 === 'lg') { cons = nextIsVowel ? 'ల్గ' : 'ల్గ్'; len = 2; }
        else if (c2 === 'lp') { cons = nextIsVowel ? 'ల్ప' : 'ల్ప్'; len = 2; }
        else if (c2 === 'lb') { cons = nextIsVowel ? 'ల్బ' : 'ల్బ్'; len = 2; }
        else if (c2 === 'lm') { cons = nextIsVowel ? 'ల్మ' : 'ల్మ్'; len = 2; }
        else if (c2 === 'qu') { cons = 'క్వ'; len = 2; }
        else if (c2 === 'ck') { cons = 'క్'; len = 2; }
        else if (c2 === 'ct') { cons = 'క్ట్'; len = 2; }
        else if (c2 === 'ft') { cons = 'ఫ్ట్'; len = 2; }
        else if (c2 === 'lt') { cons = 'ల్ట్'; len = 2; }
        else if (c2 === 'ld') { cons = 'ల్డ్'; len = 2; }
        else if (c2 === 'ch') { cons = 'చ'; len = 2; }
        else if (c2 === 'sh') {
          // In native Telugu Sanskrit roots (e.g. shiva, sharma, shankar, shanthi), sh maps to శ
          cons = 'శ'; len = 2;
        }
        else if (c2 === 'kh') { cons = 'ఖ'; len = 2; }
        else if (c2 === 'gh') { cons = 'ఘ'; len = 2; }
        else if (c2 === 'th') { cons = 'త'; len = 2; }
        else if (c2 === 'dh') { cons = 'ధ'; len = 2; }
        else if (c2 === 'ph') { cons = 'ఫ'; len = 2; }
        else if (c2 === 'bh') { cons = 'భ'; len = 2; }
        else if (c2 === 'jh') { cons = 'ఝ'; len = 2; }
        else if (c2 === 'kr' || c2 === 'cr') { cons = 'క్ర'; len = 2; }
        else if (c2 === 'pr') { cons = 'ప్ర'; len = 2; }
        else if (c2 === 'tr') { cons = 'ట్ర'; len = 2; }
        else if (c2 === 'gr') { cons = 'గ్ర'; len = 2; }
        else if (c2 === 'br') { cons = 'బ్ర'; len = 2; }
        else if (c2 === 'dr') { cons = 'డ్ర'; len = 2; }
        else if (c2 === 'fr') { cons = 'ఫ్ర'; len = 2; }
        else if (c2 === 'vr') { cons = 'వ్ర'; len = 2; }
        else if (c2 === 'mr') { cons = 'మ్ర'; len = 2; }
        else if (c2 === 'ny') { cons = 'న్య'; len = 2; }
        else if (c2 === 'rl') { cons = 'ర్ల'; len = 2; }
        else if (c2 === 'rk') { cons = 'ర్క్'; len = 2; }
        else if (c2 === 'rm') { cons = 'ర్మ'; len = 2; }
        else if (c2 === 'rn') { cons = 'ర్ణ'; len = 2; }
        else if (c2 === 'rp') { cons = 'ర్ప'; len = 2; }
        else if (c2 === 'rt') { cons = 'ర్ట్'; len = 2; }
        else if (c2 === 'rd') { cons = 'ర్డ్'; len = 2; }
        else if (c2 === 'rg') { cons = 'ర్గ'; len = 2; }
        else if (c2 === 'rv' || c2 === 'rw') { cons = 'ర్వ'; len = 2; }
        else if (c2 === 'st') { cons = nextIsVowel ? 'స్ట' : 'స్ట్'; len = 2; }
        else if (c2 === 'sk' || c2 === 'sc') { cons = nextIsVowel ? 'స్క' : 'స్క్'; len = 2; }
        else if (c2 === 'sl') { cons = nextIsVowel ? 'స్ల' : 'స్ల్'; len = 2; }
        else if (c2 === 'sv' || c2 === 'sw') { cons = 'స్వ'; len = 2; }
        else if (c2 === 'll') { cons = 'ల్ల'; len = 2; }
        else if (c2 === 'pp') { cons = 'ప్ప'; len = 2; }
        else if (c2 === 'tt') { cons = 'ట్ట'; len = 2; }
        else if (c2 === 'dd') { cons = 'డ్డ'; len = 2; }
        else if (c2 === 'mm') { cons = 'మ్మ'; len = 2; }
        else if (c2 === 'nn') { cons = 'న్న'; len = 2; }
        else if (c2 === 'bb') { cons = 'బ్బ'; len = 2; }
        else if (c2 === 'gg') { cons = 'గ్గ'; len = 2; }
        else if (c2 === 'kk' || c2 === 'cc') { cons = 'క్క'; len = 2; }
        else if (c2 === 'ss') { cons = 'స్స'; len = 2; }
        else if (c2 === 'ff') { cons = 'ఫ్ఫ'; len = 2; }
        else if (c2 === 'jj') { cons = 'జ్జ'; len = 2; }
        else if (c2 === 'vv' || c2 === 'ww') { cons = 'వ్వ'; len = 2; }
        else if (c2 === 'nj') { cons = nextIsVowel ? 'ంజ' : 'ంజ్'; len = 2; }
        else if (c2 === 'nd') {
          const prev = (i > 0) ? s[i - 1] : '';
          const nextTwo = (i + 2 < s.length) ? s.substring(i + 2) : '';
          // In Indic Sanskrit/Telugu names like Vandana, Chandan, Nandan, Sundar, Mandara: dental 'ంద'
          if (nextTwo.startsWith('an') || nextTwo.startsWith('ana') || nextTwo.startsWith('ar') || nextTwo.startsWith('ur') || nextTwo.startsWith('in') || nextTwo.startsWith('it')) {
            cons = nextIsVowel ? 'ంద' : 'ండ్';
          } else if (prev === 'o' || prev === 'u') {
            cons = nextIsVowel ? 'ండ' : 'ండ్';
          } else {
            cons = nextIsVowel ? 'ంద' : 'ండ్';
          }
          len = 2;
        }
        else if (c2 === 'nt') {
          const prev = (i > 0) ? s[i - 1] : '';
          if (prev === 'u' || prev === 'o') {
            cons = nextIsVowel ? 'ంట' : 'ంట్';
          } else {
            cons = nextIsVowel ? 'ంత' : 'ంట్';
          }
          len = 2;
        }
        else if (c2 === 'mp') { cons = nextIsVowel ? 'ంప' : 'ంప్'; len = 2; }
        else if (c2 === 'mb') { cons = nextIsVowel ? 'ంబ' : 'ంబ్'; len = 2; }
        else if (c2 === 'ng') { cons = nextIsVowel ? 'ంగ' : 'ంగ్'; len = 2; }
        else if (c2 === 'nk') { cons = nextIsVowel ? 'ంక' : 'ంక్'; len = 2; }
        else if (c2 === 'ns') { cons = 'న్స్'; len = 2; }
        else if (c2 === 'ls') { cons = 'ల్స్'; len = 2; }
        else if (c2 === 'rs') { cons = 'ర్స్'; len = 2; }
        else if (c2 === 'ts') { cons = 'ట్స్'; len = 2; }
        else if (c2 === 'ks') { cons = 'క్స్'; len = 2; }
        else if (c2 === 'cy') { cons = 'సై'; len = 2; }
        else if (c2 === 'by') { cons = 'బై'; len = 2; }
        else if (c2 === 'hy') { cons = 'హై'; len = 2; }
        else if (c2 === 'ly' || c2 === 'li') { cons = 'లి'; len = 2; }
        else if (c2 === 'ni') { cons = 'ని'; len = 2; }
        else if (c2 === 'ry' || c2 === 'ri') { cons = 'రి'; len = 2; }
        else if (c2 === 'sy' || c2 === 'si') { cons = 'సి'; len = 2; }
        else if (c2 === 'ti') { cons = 'టి'; len = 2; }
        else if (c2 === 'my' || c2 === 'mi') { cons = 'మి'; len = 2; }
        else if (c2 === 'py' || c2 === 'pi') { cons = 'పి'; len = 2; }
        else if (c2 === 'bi') { cons = 'బి'; len = 2; }
        else if (c2 === 'vi' || c2 === 'vy') { cons = 'వి'; len = 2; }
      }

      // Single-character consonants
      if (!cons) {
        const c1 = s[i];
        if (c1 === 'c' && i + 1 < s.length && /[eiy]/.test(s[i + 1])) {
          cons = 'స';
        } else if (c1 === 'k' || c1 === 'c' || c1 === 'q') {
          cons = 'క';
        } else if (c1 === 'g') {
          cons = 'గ';
        } else if (c1 === 'j') {
          cons = 'జ';
        } else if (c1 === 't') {
          // In Indian words & names ending in -at/-ath/-it/-et, use Dental Ta: త
          const isWordEnd = (i + 1 === s.length || (i + 2 === s.length && s[i + 1] === 'h'));
          cons = (isStart || isWordEnd) ? 'త' : 'ట';
        } else if (c1 === 'd') {
          const isWordEnd = (i + 1 === s.length || (i + 2 === s.length && s[i + 1] === 'h'));
          cons = (isStart || isWordEnd) ? 'ద' : 'డ';
        } else if (c1 === 'n') {
          cons = 'న';
        } else if (c1 === 'p') {
          cons = 'ప';
        } else if (c1 === 'b') {
          cons = 'బ';
        } else if (c1 === 'm') {
          cons = 'మ';
        } else if (c1 === 'y') {
          cons = 'య';
        } else if (c1 === 'r') {
          cons = 'ర';
        } else if (c1 === 'l') {
          cons = 'ల';
        } else if (c1 === 'v' || c1 === 'w') {
          cons = 'వ';
        } else if (c1 === 's' || c1 === 'z') {
          cons = 'స';
        } else if (c1 === 'h') {
          cons = 'హ';
        } else if (c1 === 'f') {
          cons = 'ఫ';
        } else if (c1 === 'x') {
          cons = 'క్స్';
        }
        len = 1;
      }

      i += len;
      isStart = false;

      // 3. Vowel Matra & Digraph Engine
      let matra = '';
      let vlen = 0;

      if (i < s.length) {
        // 4-char vowel digraphs
        if (i + 4 <= s.length) {
          const v4 = s.substring(i, i + 4);
          if (v4 === 'eigh' || v4 === 'aigh') { matra = 'ై'; vlen = 4; }
        }

        // 3-char vowel digraphs
        if (!matra && i + 3 <= s.length) {
          const v3 = s.substring(i, i + 3);
          if (v3 === 'igh') { matra = 'ై'; vlen = 3; }
          else if (v3 === 'aya') {
            matra = 'ాయ'; vlen = 3;
          }
        }

        // 2-char vowel digraphs
        if (!matra && i + 2 <= s.length) {
          const v2 = s.substring(i, i + 2);
          if (v2 === 'aa') { matra = 'ా'; vlen = 2; }
          else if (v2 === 'ee' || v2 === 'ea') { matra = 'ీ'; vlen = 2; }
          else if (v2 === 'oo' || v2 === 'uu') { matra = 'ూ'; vlen = 2; }
          else if (v2 === 'ou' || v2 === 'au' || v2 === 'aw') { matra = 'ౌ'; vlen = 2; }
          else if (v2 === 'ai') { matra = 'ై'; vlen = 2; }
          else if (v2 === 'ay' || v2 === 'ey') { matra = 'ే'; vlen = 2; }
          else if (v2 === 'oa') { matra = 'ో'; vlen = 2; }
          else if (v2 === 'oi' || v2 === 'oy') { matra = 'ాయి'; vlen = 2; }
          else if (v2 === 'ow') {
            matra = (i + 2 === s.length) ? 'ో' : 'వ';
            vlen = 2;
          }
        }

        // 1-char vowel matras (single 'a' is short inherent vowel in Telugu - no deergham)
        if (!matra) {
          const v1 = s[i];
          const hasSilentE = (s.endsWith('e') && i === s.length - 1 && s.length > 2);

          if (v1 === 'a') {
            matra = ''; // Standard Telugu short inherent vowel (అకారం)
            vlen = 1;
          } else if (v1 === 'i') {
            matra = 'ి'; vlen = 1;
          } else if (v1 === 'u') {
            matra = 'ు'; vlen = 1;
          } else if (v1 === 'e') {
            // In Indian/Telugu personal names & words (e.g. Ramesh, Suresh, Sneha, Neha, Deva, Keshava, Chetan), 'e' before consonant is long 'ే' (ఏత్వం)
            const isFollowedByConsonant = (i + 1 < s.length && !/[aeiouy]/.test(s[i + 1]));
            matra = hasSilentE ? '' : (isFollowedByConsonant ? 'ే' : 'ె');
            vlen = 1;
          } else if (v1 === 'o') {
            // In Indian/Telugu personal names & words (e.g. Santosh, Rohan, Mohan, Sohan, Gopal, Govind), 'o' before consonant is 'ో' (ఓత్వం)
            const isFollowedByConsonant = (i + 1 < s.length && !/[aeiouy]/.test(s[i + 1]));
            matra = isFollowedByConsonant ? 'ో' : 'ొ';
            vlen = 1;
          } else if (v1 === 'y') {
            if (i + 1 === s.length) {
              matra = 'ి';
              vlen = 1;
            } else if (!/[aeiou]/.test(s[i + 1])) {
              matra = 'ై';
              vlen = 1;
            } else {
              matra = '';
              vlen = 0;
            }
          }
        }
      } else {
        // End of word consonant ending with Virama
        if (cons && !cons.endsWith('ా') && !cons.endsWith('ి') && !cons.endsWith('ీ') &&
            !cons.endsWith('ు') && !cons.endsWith('ూ') && !cons.endsWith('ె') &&
            !cons.endsWith('ే') && !cons.endsWith('ొ') && !cons.endsWith('ో') &&
            !cons.endsWith('ౌ') && !cons.endsWith('ై') &&
            !cons.endsWith('్') && !cons.endsWith('ర') && !cons.endsWith('ల') &&
            !cons.endsWith('న') && !cons.endsWith('ం') && !cons.endsWith('ండ') &&
            !cons.endsWith('ంట') && !cons.endsWith('ంప') && !cons.endsWith('ంబ') &&
            !cons.endsWith('మ్మ') && !cons.endsWith('ప్ప') && !cons.endsWith('న్న') &&
            !cons.endsWith('య్య') && !cons.endsWith('ల్ల') && !cons.endsWith('వ్వ') &&
            !cons.endsWith('ట్ల') && !cons.endsWith('డ్ల') && !cons.endsWith('ర్ల') &&
            !cons.endsWith('ష్ణ') && !cons.endsWith('జ్ఞ') && !cons.endsWith('త్య') &&
            !cons.endsWith('ద్య') && !cons.endsWith('భ్య') && !cons.endsWith('ధ్య') &&
            !cons.endsWith('వ్య') && !cons.endsWith('మ్య') && !cons.endsWith('ప్య') &&
            !cons.endsWith('బ్య') && !cons.endsWith('ర్య') && !cons.endsWith('ల్య') &&
            !cons.endsWith('స్య') && !cons.endsWith('శ్య') && !cons.endsWith('క్ష') &&
            !cons.endsWith('క్ష్య') && !cons.endsWith('త్మ') && !cons.endsWith('ద్మ') &&
            !cons.endsWith('స్మ') && !cons.endsWith('ష్మ') && !cons.endsWith('హ్మ') &&
            !cons.endsWith('త్న') && !cons.endsWith('స్న') && !cons.endsWith('ప్న') &&
            !cons.endsWith('గ్న') && !cons.endsWith('భ్న') && !cons.endsWith('హ్న')) {
          matra = '్';
        }
      }

      i += vlen;

      if (cons) {
        if (cons.endsWith('్') && (vlen > 0 || (matra !== '' && matra !== '్'))) {
          cons = cons.slice(0, -1);
        }
        out += cons + matra;
      }
    }

    // Post-processing adjustments for authentic native local Telugu phonetics
    if (out.endsWith('ల') && (s.endsWith('al') || s.endsWith('el') || s.endsWith('il') || s.endsWith('ul'))) out = out.slice(0, -1) + 'ల్';
    if (out.endsWith('ర') && (s.endsWith('er') || s.endsWith('or') || s.endsWith('ar') || s.endsWith('ur'))) out = out.slice(0, -1) + 'ర్';
    if (out.endsWith('న') && (s.endsWith('an') || s.endsWith('en') || s.endsWith('in') || s.endsWith('on') || s.endsWith('un'))) out = out.slice(0, -1) + 'న్';

    // Word ending dental Ta (త్) for Urdu/Persian/Indian loanwords ending in -at, -ath, -it, -ith
    if ((s.endsWith('at') || s.endsWith('ath') || s.endsWith('it') || s.endsWith('ith')) && out.endsWith('ట్')) {
      out = out.slice(0, -2) + 'త్';
    }
    // Word ending dental Da (ద్) for Urdu/Persian/Indian loanwords ending in -ad, -adh, -ed, -id, -ud
    if ((s.endsWith('ad') || s.endsWith('adh') || s.endsWith('ed') || s.endsWith('id') || s.endsWith('ud')) && out.endsWith('డ్')) {
      out = out.slice(0, -2) + 'ద్';
    }
    // Word ending retroflex Sha (ష్) for Indian names ending in -esh, -ish, -osh, -ush, -ash
    if ((s.endsWith('esh') || s.endsWith('ish') || s.endsWith('osh') || s.endsWith('ush') || s.endsWith('ash')) && (out.endsWith('శ్') || out.endsWith('శ') || out.endsWith('ష్') || out.endsWith('ష'))) {
      if (out.endsWith('శ్') || out.endsWith('ష్')) out = out.slice(0, -2) + 'ష్';
      else out = out.slice(0, -1) + 'ష్';
    }

    return out;
  }

  spellAcronymHindi(str) {
    const speller = {
      'a': 'ए', 'b': 'बी', 'c': 'सी', 'd': 'डी', 'e': 'ई', 'f': 'एफ',
      'g': 'जी', 'h': 'एच', 'i': 'आई', 'j': 'जे', 'k': 'के', 'l': 'एल',
      'm': 'एम', 'n': 'एन', 'o': 'ओ', 'p': 'पी', 'q': 'क्यू', 'r': 'आर',
      's': 'एस', 't': 'टी', 'u': 'यू', 'v': 'वी', 'w': 'डब्ल्यू',
      'x': 'एक्स', 'y': 'वाई', 'z': 'ज़ेड'
    };
    let out = '';
    for (let char of str) {
      if (speller[char]) out += speller[char];
    }
    return out;
  }

  parsePhoneticHindi(str) {
    let s = str.toLowerCase();
    const hindiDict = {
      'stop': 'स्टॉप', 'stops': 'स्टॉप्स', 'bus': 'बस', 'terminal': 'टर्मिनल', 'airport': 'एयरपोर्ट',
      'railway': 'रेलवे', 'station': 'स्टेशन', 'express': 'एक्सप्रेस', 'city': 'सिटी', 'cross': 'क्रॉस',
      'road': 'रोड', 'roads': 'रोड्स', 'junction': 'जंक्शन', 'colony': 'कॉलोनी', 'nagar': 'नगर',
      'bazaar': 'बाज़ार', 'market': 'मार्केट', 'gate': 'गेट', 'bridge': 'ब्रिज', 'flyover': 'फ्लाईओवर',
      'hospital': 'अस्पताल', 'college': 'कॉलेज', 'school': 'स्कूल', 'university': 'यूनिवर्सिटी',
      'depot': 'डिपो', 'circle': 'सर्किल', 'complex': 'कॉम्प्लेक्स', 'temple': 'मंदिर', 'masjid': 'मस्जिद',
      'church': 'चर्च', 'paradise': 'पैराडाइज', 'secunderabad': 'सिकंदराबाद', 'hyderabad': 'हैदराबाद',
      'charminar': 'चारमीनार', 'koti': 'कोटी', 'afzalgunj': 'अफजलगंज', 'ameerpet': 'अमीरपेट',
      'kukatpally': 'कूकटपल्ली', 'jbs': 'जेबीएस', 'mgbs': 'एमजीबीएस', 'cbs': 'सीबीएस', 'ecil': 'ईसीआईएल',
      'dilsukhnagar': 'दिलसुखनगर', 'bowenpally': 'बोवेनपल्ली', 'uppal': 'उप्पल', 'lb nagar': 'एलबी नगर',
      'hitech city': 'हाईटेक सिटी', 'madhapur': 'माधापुर', 'gachibowli': 'गच्चीबाउली', 'mehdipatnam': 'महेंदीपटनम',
      'tadbund': 'ताड़बंद', 'suchitra': 'सुचित्रा', 'shamshabad': 'शमशाबाद', 'lingampally': 'लिंगमपल्ली',
      'patancheru': 'पाटनचेरु', 'miyapur': 'मियापुर', 'borabanda': 'बोराबंडा', 'sanathnagar': 'सनतनगर',
      'balanagar': 'बालानगर', 'jeedimetla': 'जीडीमेट्ला', 'tarnaka': 'तारनाका', 'habsiguda': 'हब्सीगुड़ा',
      'malkajgiri': 'मलकाजगिरि', 'alwal': 'अलवाल', 'kompally': 'कोमपल्ली', 'medchal': 'मेदचल',
      'kacheguda': 'काचेगुड़ा', 'nampally': 'नामपल्ली', 'abids': 'अबिड्स', 'lakdikapul': 'लकड़ीकापुल',
      'punjagutta': 'पंजागुट्टा', 'somajiguda': 'सोमाजीगुड़ा', 'begumpet': 'बेगमपेट', 'khairatabad': 'खैराताबाद',
      'jubilee hills': 'जुबली हिल्स', 'banjara hills': 'बंजारा हिल्स', 'manikonda': 'मणिकोंडा', 'kondapur': 'कोंडापुर'
    };

    if (hindiDict[s]) return hindiDict[s];

    let i = 0;
    let out = '';
    let isStart = true;

    while (i < s.length) {
      if (isStart) {
        if (s.substring(i, i + 3) === 'air') { out += 'एयर'; i += 3; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'aa') { out += 'आ'; i += 2; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'ee' || s.substring(i, i + 2) === 'ea') { out += 'ई'; i += 2; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'oo' || s.substring(i, i + 2) === 'uu') { out += 'ऊ'; i += 2; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'ai' || s.substring(i, i + 2) === 'ay') { out += 'ऐ'; i += 2; isStart = false; continue; }
        if (s.substring(i, i + 2) === 'au' || s.substring(i, i + 2) === 'ou') { out += 'औ'; i += 2; isStart = false; continue; }
        if (s[i] === 'a') { out += 'अ'; i += 1; isStart = false; continue; }
        if (s[i] === 'i') { out += 'इ'; i += 1; isStart = false; continue; }
        if (s[i] === 'u') { out += 'उ'; i += 1; isStart = false; continue; }
        if (s[i] === 'e') { out += 'ए'; i += 1; isStart = false; continue; }
        if (s[i] === 'o') { out += 'ओ'; i += 1; isStart = false; continue; }
      }

      isStart = false;
      let cons = '';
      let len = 0;

      // 4-char & 3-char clusters
      if (i + 4 <= s.length) {
        const c4 = s.substring(i, i + 4);
        if (c4 === 'tion' || c4 === 'sion') { cons = 'शन'; len = 4; }
        else if (c4 === 'ksha') { cons = 'क्ष'; len = 4; }
      }

      if (!cons && i + 3 <= s.length) {
        const c3 = s.substring(i, i + 3);
        if (c3 === 'shw' || c3 === 'shv') { cons = 'श्व'; len = 3; }
        else if (c3 === 'shr' || c3 === 'sri') { cons = 'श्र'; len = 3; }
        else if (c3 === 'ksh') { cons = 'क्ष'; len = 3; }
        else if (c3 === 'thr') { cons = 'त्र'; len = 3; }
        else if (c3 === 'dhr') { cons = 'ध्र'; len = 3; }
        else if (c3 === 'str') { cons = 'स्ट्र'; len = 3; }
        else if (c3 === 'spr') { cons = 'स्प्र'; len = 3; }
        else if (c3 === 'spl') { cons = 'स्प्ल'; len = 3; }
      }

      // 2-char clusters
      if (!cons && i + 2 <= s.length) {
        const c2 = s.substring(i, i + 2);
        if (c2 === 'kh') { cons = 'ख'; len = 2; }
        else if (c2 === 'gh') { cons = 'घ'; len = 2; }
        else if (c2 === 'ch') { cons = 'च'; len = 2; }
        else if (c2 === 'jh') { cons = 'झ'; len = 2; }
        else if (c2 === 'th') { cons = 'थ'; len = 2; }
        else if (c2 === 'dh') { cons = 'ध'; len = 2; }
        else if (c2 === 'ph') { cons = 'फ'; len = 2; }
        else if (c2 === 'bh') { cons = 'भ'; len = 2; }
        else if (c2 === 'sh') { cons = 'श'; len = 2; }
        else if (c2 === 'tr') { cons = 'त्र'; len = 2; }
        else if (c2 === 'gy' || c2 === 'jn') { cons = 'ज्ञ'; len = 2; }
        else if (c2 === 'st') { cons = 'स्ट'; len = 2; }
        else if (c2 === 'sp') { cons = 'स्प'; len = 2; }
        else if (c2 === 'sk') { cons = 'स्क'; len = 2; }
        else if (c2 === 'sm') { cons = 'स्म'; len = 2; }
        else if (c2 === 'sn') { cons = 'स्न'; len = 2; }
        else if (c2 === 'pr') { cons = 'प्र'; len = 2; }
        else if (c2 === 'kr') { cons = 'क्र'; len = 2; }
        else if (c2 === 'gr') { cons = 'ग्र'; len = 2; }
        else if (c2 === 'dr') { cons = 'द्र'; len = 2; }
        else if (c2 === 'br') { cons = 'ब्र'; len = 2; }
      }

      // 1-char consonants
      if (!cons && i < s.length) {
        const c1 = s[i];
        const singleMap = {
          'k': 'क', 'g': 'ग', 'c': 'क', 'j': 'ज', 't': 'ट', 'd': 'ड',
          'n': 'न', 'p': 'प', 'b': 'ब', 'm': 'म', 'y': 'य', 'r': 'र',
          'l': 'ल', 'v': 'व', 'w': 'व', 's': 'स', 'h': 'ह', 'f': 'फ',
          'z': 'ज़', 'q': 'क', 'x': 'क्स'
        };
        if (singleMap[c1]) { cons = singleMap[c1]; len = 1; }
      }

      if (!cons) {
        out += s[i];
        i++;
        continue;
      }

      i += len;

      // Check vowels/matras
      let matra = '';
      let vlen = 0;
      if (i < s.length) {
        if (i + 2 <= s.length) {
          const v2 = s.substring(i, i + 2);
          if (v2 === 'aa') { matra = 'ा'; vlen = 2; }
          else if (v2 === 'ee' || v2 === 'ea') { matra = 'ी'; vlen = 2; }
          else if (v2 === 'oo' || v2 === 'uu') { matra = 'ू'; vlen = 2; }
          else if (v2 === 'ai' || v2 === 'ay') { matra = 'ै'; vlen = 2; }
          else if (v2 === 'au' || v2 === 'ou' || v2 === 'aw') { matra = 'ौ'; vlen = 2; }
        }

        if (!matra && i < s.length) {
          const v1 = s[i];
          if (v1 === 'a') { matra = (i === s.length - 1 && s.length > 2) ? 'ा' : ''; vlen = 1; }
          else if (v1 === 'i') { matra = 'ि'; vlen = 1; }
          else if (v1 === 'u') { matra = 'ु'; vlen = 1; }
          else if (v1 === 'e') { matra = 'े'; vlen = 1; }
          else if (v1 === 'o') { matra = 'ो'; vlen = 1; }
        }
      }

      i += vlen;
      out += cons + matra;
    }

    return out;
  }

  transliterateTelugu(text) {
    if (!text) return '';
    const words = text.split(/(\s+|[-/&,])/);
    return words.map(w => {
      if (!w || /^\s+$/.test(w) || /^[-/&,]$/.test(w)) return w;
      const lower = w.toLowerCase();
      if (this.dictionary && this.dictionary[lower]) return this.dictionary[lower];
      if (/^[a-z]{2,5}$/.test(lower) && !/[aeiouy]/.test(lower)) {
        return this.spellAcronym(lower);
      }
      return this.parsePhonetic(lower);
    }).join('');
  }

  transliterateHindi(text) {
    if (!text) return '';
    const words = text.split(/(\s+|[-/&,])/);
    return words.map(w => {
      if (!w || /^\s+$/.test(w) || /^[-/&,]$/.test(w)) return w;
      const lower = w.toLowerCase();
      if (/^[a-z]{2,5}$/.test(lower) && !/[aeiouy]/.test(lower)) {
        return this.spellAcronymHindi(lower);
      }
      return this.parsePhoneticHindi(lower);
    }).join('');
  }

  transliterate(text, targetLang = 'te') {
    if (!text || typeof text !== 'string') return '';
    const trimmed = text.trim();
    if (!trimmed) return '';
    if (targetLang === 'hi') {
      return this.transliterateHindi(trimmed);
    }
    return this.transliterateTelugu(trimmed);
  }
}

// Global & ITMS Namespace Export
if (typeof window !== 'undefined') {
  window.ITMS = window.ITMS || {};
  window.ITMS.IndicTransliterationEngine = IndicTransliterationEngine;
  window.IndicTransliterationEngine = IndicTransliterationEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = IndicTransliterationEngine;
}


