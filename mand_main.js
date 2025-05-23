// Set up canvas and viewing parameters.
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const width = canvas.width, height = canvas.height;
const initialStep = 16;  // Must be a power of 2
const lastStep = 1;      // Stop refining when we reach this step size
const defaultScale = 3.0;
const defaultX = -0.5, defaultY = 0.0;
const defaultIter = 1024;

// Defaults are also set here, but can be overridden by URL parameters.
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    centerX: parseFloat(params.get('centerX')) || defaultX,
    centerY: parseFloat(params.get('centerY')) || defaultY,
    scale: parseFloat(params.get('scale')) || defaultScale,
    maxIterations: parseInt(params.get('maxIterations')) || defaultIter
  };
}

function updateUrlParams(centerX, centerY, scale, maxIterations) {
  const params = new URLSearchParams();
  params.set('maxIterations', maxIterations);
  params.set('scale', scale);
  params.set('centerX', centerX);
  params.set('centerY', centerY);
  window.history.pushState({}, '', `${window.location.pathname}?${params}`);
}

function calculateMaxIterations(scale) {
  const additionalIterations = Math.ceil(128 * Math.log10(1 / scale));
  return 256 + Math.max(0, additionalIterations);
}

const { centerX: initialCenterX, centerY: initialCenterY, scale: initialScale, maxIterations: initialMaxIterations } = getUrlParams();
let centerX = initialCenterX, centerY = initialCenterY, scale = initialScale;
let maxIterations = initialMaxIterations === 'auto' ? calculateMaxIterations(scale) : parseInt(initialMaxIterations);

// Each click will recenter on the clicked point and zoom in by a factor of 4.
let currentRenderId = 0;  // Increases with each new render (to discard late messages).
let currentIteration = 0; // Tracks the current refinement iteration.

// Create an ImageData buffer that we update progressively.
let imageData = ctx.getImageData(0, 0, width, height);

// Create a pool of Web Workers.
const numWorkers = Math.min(navigator.hardwareConcurrency || 4, 16);
console.log(`Using ${numWorkers} workers`);
// const numWorkers = 8;
const workers = [];

function getColor(n, maxIterations) {
  if (n === maxIterations) {
    return { r: 0, g: 0, b: 0, a: 255 };  // Points inside the set: black.
  } else {
    // Smooth color gradient
    var t = n / maxIterations;
    var r = Math.floor(9 * (1 - t) * t * t * t * 255);
    var g = Math.floor(15 * (1 - t) * (1 - t) * t * t * 255);
    var b = Math.floor(8.5 * (1 - t) * (1 - t) * (1 - t) * t * 255);
    return { r: r, g: g, b: b, a: 255 };
  }
}

function blendPixel(imageData, x, y, color, weight) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const idx = (y * width + x) * 4;
  imageData.data[idx]     = (imageData.data[idx]     * (1-weight) + color.r * weight);
  imageData.data[idx + 1] = (imageData.data[idx + 1] * (1-weight) + color.g * weight);
  imageData.data[idx + 2] = (imageData.data[idx + 2] * (1-weight) + color.b * weight);
  imageData.data[idx + 3] = 255;
}

// Setup workers...
for (let i = 0; i < numWorkers; i++) {
  const worker = new Worker('mand_worker.js');
  worker.onmessage = function(e) {
    const data = e.data;
    // Discard any results from an outdated render.
    if (data.renderId !== currentRenderId) return;
    const s = data.s;
    const results = data.results;
    // For each computed point, fill its s×s block in the image buffer.
    results.forEach(function (p) {
      const color = getColor(p.n, maxIterations);
      if (s >= 1) {
        // Integer block size - direct pixel assignment
        for (let dy = 0; dy < s; dy++) {
          for (let dx = 0; dx < s; dx++) {
            const px = Math.floor(p.x + dx);
            const py = Math.floor(p.y + dy);
            blendPixel(imageData, px, py, color, 1.0);
          }
        }
      } else {
        // Fractional block size - anti-alias in RGB space
        const x0 = Math.floor(p.x), y0 = Math.floor(p.y);
        const x1 = Math.ceil(p.x + s), y1 = Math.ceil(p.y + s);
        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            // Calculate overlap area for this pixel
            const left = Math.max(p.x, px);
            const right = Math.min(p.x + s, px + 1);
            const top = Math.max(p.y, py);
            const bottom = Math.min(p.y + s, py + 1);
            
            if (right > left && bottom > top) {
              const weight = (right - left) * (bottom - top);
              blendPixel(imageData, px, py, color, weight);
            }
          }
        }
      }
    });
    // Update the canvas display.
    ctx.putImageData(imageData, 0, 0);
    // When every worker has returned, schedule the next (more refined) iteration.
    currentIterationPending--;
    updateDataWindow();
    if (currentIterationPending === 0) {
      // Proceed to the next iteration if above lastStep
      if (s > lastStep) {
        runIteration(s / 2, currentIteration + 1);
      }
    }
  };
  workers.push(worker);
}

// Global counter for the pending worker tasks.
let currentIterationPending = 0;

// runIteration dispatches tasks to all workers to compute new points for block size s.
function runIteration(s, iteration) {
  // Stop work on all workers...
  workers.forEach(worker => worker.postMessage({ terminate: true }));
  // Return if we're at the last step
  if (s < lastStep) return;
  currentIteration = iteration;
  currentIterationPending = numWorkers;
  updateDataWindow();
  // Partition the vertical range into segments (one per worker).
  const segmentHeight = Math.ceil(height / numWorkers);
  for (let i = 0; i < numWorkers; i++) {
    const yStart = i * segmentHeight;
    const yEnd = Math.min(height, (i + 1) * segmentHeight);
    workers[i].postMessage({
      renderId: currentRenderId,
      s: s,
      iteration: iteration,
      yStart: yStart,
      yEnd: yEnd,
      width: width,
      height: height,
      centerX: centerX,
      centerY: centerY,
      scale: scale,
      maxIterations: maxIterations
    });
  }
}

// startRender resets the display and begins the progressive (iterative) computation.
const dataWindow = document.getElementById('data-window');
const resetButton = document.getElementById('reset-button');

function updateDataWindow() {
  dataWindow.innerHTML = `Center: (${centerX.toFixed(5)}, ${centerY.toFixed(5)})<br>`;
  dataWindow.innerHTML += `Scale: ${Math.round(defaultScale / scale)}x`;
  dataWindow.innerHTML += `<br>Max iterations: ${maxIterations}`;
  dataWindow.innerHTML += `<br>Workers: ${currentIterationPending}/${numWorkers}`;
}

function startRender(newCenterX, newCenterY, newScale, logIterations = false) {
  currentRenderId++;
  centerX = newCenterX;
  centerY = newCenterY;
  scale = newScale;
  maxIterations = initialMaxIterations === 'auto' ? calculateMaxIterations(scale) : parseInt(initialMaxIterations);
  if (logIterations) {
    console.log(`maxIterations: ${maxIterations}`);
  }
  updateUrlParams(centerX, centerY, scale, initialMaxIterations);
  updateDataWindow(); // Update data window with new values
  runIteration(initialStep, 0); // Begin with the coarsest resolution.
}

resetButton.addEventListener('click', () => {
  startRender(defaultX, defaultY, defaultScale, true);
});

// Start the initial render.
startRender(centerX, centerY, scale);

// When the user clicks, recenter on that complex coordinate and zoom in (scale divided by 4).
canvas.addEventListener("click", function (e) {
  if (e.button === 0 && !hasDragged) { // Left click and no drag
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    // Map the clicked pixel to the complex plane.
    const newCenterX = centerX + (x - width / 2) * (scale / width);
    const newCenterY = centerY + (y - height / 2) * (scale / width);
    const newScale = scale / 4;
    startRender(newCenterX, newCenterY, newScale, true);
  }
});

// When the user right-clicks, recenter on that complex coordinate and zoom out (scale multiplied by 4).
canvas.addEventListener("contextmenu", function (e) {
  e.preventDefault(); // Prevent the context menu from appearing
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  // Map the clicked pixel to the complex plane.
  const newCenterX = centerX + (x - width / 2) * (scale / width);
  const newCenterY = centerY + (y - height / 2) * (scale / width);
  const newScale = scale * 4;
  startRender(newCenterX, newCenterY, newScale, true);
});

// Modify wheel zoom support
canvas.addEventListener("wheel", function (e) {
  e.preventDefault(); // Prevent page scrolling

  // Zoom in or out based on scroll direction
  const zoomFactor = 1.2;
  const newScale = e.deltaY > 0 ? scale * zoomFactor : scale / zoomFactor;

  startRender(centerX, centerY, newScale, true);
});

// Handle the popstate event to re-render the view when navigating history.
window.addEventListener('popstate', () => {
  const { centerX: newCenterX, centerY: newCenterY, scale: newScale, maxIterations: newMaxIterations } = getUrlParams();
  maxIterations = newMaxIterations === 'auto' ? calculateMaxIterations(newScale) : parseInt(newMaxIterations);
  console.log(`maxIterations: ${maxIterations}`);
  startRender(newCenterX, newCenterY, newScale);
});

let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let dragStartCenterX = 0, dragStartCenterY = 0;
let lastDragUpdate = 0;
const dragUpdateInterval = 100; // ms
let hasDragged = false;

function startDrag(x, y) {
  isDragging = true;
  hasDragged = false;
  dragStartX = x;
  dragStartY = y;
  dragStartCenterX = centerX;
  dragStartCenterY = centerY;
}

function updateDrag(x, y) {
  if (isDragging) {
    hasDragged = true;
    const now = Date.now();
    if (now - lastDragUpdate >= dragUpdateInterval) {
      lastDragUpdate = now;
      const dx = x - dragStartX;
      const dy = y - dragStartY;
      const newCenterX = dragStartCenterX - dx * (scale / width);
      const newCenterY = dragStartCenterY - dy * (scale / height);
      startRender(newCenterX, newCenterY, scale);
    }
  }
}

function endDrag() {
  isDragging = false;
}

canvas.addEventListener("mousedown", function (e) {
  if (e.button === 0) { // Left button
    startDrag(e.clientX, e.clientY);
  }
});

canvas.addEventListener("mousemove", function (e) {
  updateDrag(e.clientX, e.clientY);
});

canvas.addEventListener("mouseup", function (e) {
  if (e.button === 0) { // Left button
    endDrag();
  }
});

canvas.addEventListener("mouseleave", function () {
  endDrag();
});

// Touch event listeners for mobile devices
canvas.addEventListener("touchstart", function (e) {
  if (e.touches.length === 1) { // Single touch
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);
  } else if (e.touches.length === 2) { // Pinch zoom
    e.preventDefault(); // Prevent default pinch zoom behavior
    const touch1 = e.touches[0];
    const touch2 = e.touches[1];
    pinchStartDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
    pinchStartScale = scale;
  }
});

canvas.addEventListener("touchmove", function (e) {
  if (e.touches.length === 1) { // Single touch
    const touch = e.touches[0];
    updateDrag(touch.clientX, touch.clientY);
  } else if (e.touches.length === 2) { // Pinch zoom
    e.preventDefault(); // Prevent default pinch zoom behavior
    const touch1 = e.touches[0];
    const touch2 = e.touches[1];
    const currentDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
    const scaleFactor = pinchStartDistance / currentDistance;
    const newScale = pinchStartScale * scaleFactor;
    startRender(centerX, centerY, newScale);
  }
});

canvas.addEventListener("touchend", function (e) {
  if (e.touches.length === 0) { // All touches ended
    endDrag();
  }
});

canvas.addEventListener("touchcancel", function () {
  endDrag();
});

// Variables for pinch zoom
let pinchStartDistance = 0;
let pinchStartScale = 0;
