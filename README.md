# ⚡ Zero-Dependency QR Code Generator

<p align="left">
  <img src="https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript ES6+" />
  <img src="https://img.shields.io/badge/HTML5-Canvas_API-E34F26?style=flat-square&logo=html5&logoColor=white" alt="HTML5 Canvas" />
  <img src="https://img.shields.io/badge/CSS3-Modern_Responsive-1572B6?style=flat-square&logo=css3&logoColor=white" alt="CSS3" />
  <img src="https://img.shields.io/badge/Dependencies-Zero-success?style=flat-square" alt="Zero Dependencies" />
  <img src="https://img.shields.io/badge/Privacy-100%25_Client--Side-blueviolet?style=flat-square" alt="Client-Side" />
</p>

A lightweight, zero-dependency client-side QR Code Generator built in **pure vanilla JavaScript**. Generates standard ISO/IEC 18004 compliant 2D QR matrix barcodes directly in the browser with real-time URL validation, Reed-Solomon error correction, HTML5 Canvas rendering, and high-resolution PNG export.

---

## 🎯 Key Highlights

- **100% Client-Side & Private:** No third-party APIs, CDNs, or telemetry. Text and URLs never leave the user's browser.
- **Zero External Dependencies:** Built from the mathematical foundation up—no bulky npm packages or external canvas libraries.
- **ISO/IEC 18004 Standard Compliance:**
  - **Error Correction Level M (~15% recovery):** Tolerates partial occlusion or dirt while maintaining compact symbol sizes.
  - **Automatic Version Selection (1 to 40):** Computes minimum required matrix dimension based on payload length.
  - **Optimal Mask Selection:** Evaluates standard penalty scores across all 8 QR mask patterns to optimize scanner readability.
- **Real-Time Input Validation:** Validates protocol formatting (`https://`, `http://`), strips unsafe whitespace, and provides dynamic protocol suggestions.
- **High-Resolution PNG Download:** Renders a high-density, crisp raster image (with standard quiet-zone margins) ready for print or digital sharing.

---

## 🔬 How the Encoding Algorithm Works

```
User Input URL
     │
     ▼
[URL Normalization & Validation] ──► Checks protocol, valid characters & byte length
     │
     ▼
[Byte Mode Data Encoding] ──────────► Converts UTF-8 string to 8-bit codeword stream
     │
     ▼
[Galois Field GF(2^8) ECC] ────────► Computes Reed-Solomon error-correction parity blocks
     │
     ▼
[Matrix Construction] ─────────────► Places finder patterns, timing belts, alignment marks
     │
     ▼
[Mask Evaluation] ─────────────────► Scores 8 penalty patterns (runs, 2x2 blocks, patterns)
     │
     ▼
[HTML5 Canvas Drawing] ────────────► Renders black/white modules + 4-module quiet zone
     │
     ▼
[Blob PNG Export] ─────────────────► Exports 1024x1024 sharp PNG via browser Blob API
```

1. **Codeword Generation (`qr.js`):**
   Input strings are parsed into raw UTF-8 byte arrays. Mode indicators and 8-bit character count headers are prepended, followed by bit padding to align with standard byte boundaries.
2. **Error Correction (Reed-Solomon):**
   Generates error-correcting parity codewords using polynomial long division over Galois Field $GF(2^8)$ with prime modulus polynomial $x^8 + x^4 + x^3 + x^2 + 1$ (`0x11D`).
3. **Matrix Layout & Function Patterns:**
   Places static finder patterns (7x7 eyes) at top-left, top-right, and bottom-left, along with timing tracks, alignment markers, and version/format metadata bits.
4. **Mask Selection:**
   Applies XOR mask patterns $(x + y) \pmod 2 == 0$, $y \pmod 2 == 0$, etc., and scores each for undesirable visual artifacts (e.g., contiguous module runs and false finder mimics).
5. **Canvas Rasterization (`app.js`):**
   Iterates through the generated boolean matrix and paints high-contrast modules with scalable pixel scale and quiet-zone spacing.

---

## 📁 Repository Structure

```
qr-code-generator/
├── index.html       # Accessible semantic UI with live preview container
├── style.css        # Clean, modern card interface with responsive breakpoints
├── app.js           # Form handling, URL validation logic, and Canvas export
├── qr.js            # Self-contained QR encoder engine (Reed-Solomon & Matrix)
└── .gitignore       # System file exclusions
```

---

## 💻 Running Locally

Because this application uses standard vanilla web technologies and has no build step, you can run it immediately:

### Option 1: Direct File Open
Simply double-click `index.html` or open it directly in any modern browser:
```bash
open index.html        # macOS
xdg-open index.html   # Linux
start index.html      # Windows
```

### Option 2: Local HTTP Server
```bash
# Using Python
python3 -m http.server 8080

# Or using Node
npx serve .
```
Navigate to `http://localhost:8080` in your web browser.

---

## 👩‍💻 Author

**Pallavi Bhandari**  
- GitHub: [@pallavibhandari07](https://github.com/pallavibhandari07)  
- LinkedIn: [Pallavi Bhandari](https://www.linkedin.com/in/pallavi-bhandari-8a4921380/)
