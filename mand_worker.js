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
        // Map pixel (x,y) to a complex number.
        var cx = centerX + (x - width / 2) * (scale / width);
        var cy = centerY + (y - height / 2) * (scale / width);
        var zx = 0, zy = 0, iter = 0;
        while (zx * zx + zy * zy <= 4 && iter < maxIterations) {
          var xtemp = zx * zx - zy * zy + cx;
          zy = 2 * zx * zy + cy;
          zx = xtemp;
          iter++;
        }
        var r, g, b;
        if (iter === maxIterations) {
          r = g = b = 0;  // Points inside the set: black.
        } else {
          // Smooth color gradient
          var t = iter / maxIterations;
          r = Math.floor(9 * (1 - t) * t * t * t * 255);
          g = Math.floor(15 * (1 - t) * (1 - t) * t * t * 255);
          b = Math.floor(8.5 * (1 - t) * (1 - t) * (1 - t) * t * 255);
        }
        // Each computed point represents a block of size s x s.
        results.push({ x: x, y: y, s: s, r: r, g: g, b: b, a: 255 });
      }
    }
    self.postMessage({ renderId: renderId, results: results, s: s, iteration: iteration });
  };