/**
 * Genera códigos QR reales EN EL NAVEGADOR (sin servicios externos).
 * Usa qrcode-generator (MIT) incluido en js/qrcode-generator.js.
 *
 *   QRLocal.pixeles(url, tamano)  → Uint8ClampedArray RGBA (cuadrado tamano×tamano)
 *   QRLocal.dibujar(canvas, url, tamano)
 *   QRLocal.dataUrl(url, tamano)  → "data:image/png;base64,…"
 */
var QRLocal = (function () {
  var MARGEN = 4; // módulos en blanco alrededor (mínimo del estándar)

  function matriz(url) {
    var q = qrcode(0, 'M'); // tamaño automático, corrección de errores media
    q.addData(String(url), 'Byte');
    q.make();
    return q;
  }

  function pixeles(url, tamano) {
    var q = matriz(url), n = q.getModuleCount();
    var total = n + MARGEN * 2;
    var celda = Math.max(1, Math.floor(tamano / total));
    var lado = celda * total;                      // píxeles reales (múltiplo exacto de la celda)
    var data = new Uint8ClampedArray(lado * lado * 4).fill(255);
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!q.isDark(r, c)) continue;
        var x0 = (c + MARGEN) * celda, y0 = (r + MARGEN) * celda;
        for (var y = y0; y < y0 + celda; y++) {
          for (var x = x0; x < x0 + celda; x++) {
            var i = (y * lado + x) * 4;
            data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; // alfa ya está a 255
          }
        }
      }
    }
    return { data: data, ancho: lado, alto: lado };
  }

  function dibujar(canvas, url, tamano) {
    var p = pixeles(url, tamano || 1024);
    canvas.width = p.ancho; canvas.height = p.alto;
    canvas.getContext('2d').putImageData(new ImageData(p.data, p.ancho, p.alto), 0, 0);
    return canvas;
  }

  function dataUrl(url, tamano) {
    return dibujar(document.createElement('canvas'), url, tamano).toDataURL('image/png');
  }

  return { pixeles: pixeles, dibujar: dibujar, dataUrl: dataUrl };
})();
if (typeof module !== 'undefined') module.exports = QRLocal;
