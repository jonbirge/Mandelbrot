self.onmessage = function(e) {
    var data = e.data;
    var renderId = data.renderId;
    var s = data.s;            // Current pixel block size.
    var iteration = data.iteration;
    var yStart = data.yStart;
    var yEnd = data.yEnd;
    var width = data.width;
    var height = data.height;
    var centerX = data.centerX;
    var centerY = data.centerY;
    var scale = data.scale;
    var maxIterations = data.maxIterations;
    var results = [];
    // Ensure we start at a row that is a multiple of s.
    var startY = Math.ceil(yStart / s) * s;
    for (var y = startY; y < yEnd; y += s) {
      for (var x = 0; x < width; x += s) {
        // On iterations after the first, skip points already computed at coarser resolution.
        if (iteration > 0 && (x % (2 * s) === 0) && (y % (2 * s) === 0)) {
          continue;
        }
        // Use exact center point of the block
        var cx = centerX + (x + s/2 - width / 2) * (scale / width);
        var cy = centerY + (y + s/2 - height / 2) * (scale / width);
        var zx = 0, zy = 0, iter = 0;
        while (zx * zx + zy * zy <= 4 && iter < maxIterations) {
          var xtemp = zx * zx - zy * zy + cx;
          zy = 2 * zx * zy + cy;
          zx = xtemp;
          iter++;
        }
        // Each computed point represents a block of size s x s.
        results.push({ x: x, y: y, s: s, n: iter });
      }
    }
    self.postMessage({ renderId: renderId, results: results, s: s, iteration: iteration });
};
