let cols;
let rows;
let current;
let previous;
let dampingField;

let defaultDamping = 0.99;

let intensity = 1.5;

const SIM_SCALE = 1.5;

let waveShader;
let smoothShader;
let sceneBuf;

let dataImg;
let overlay; // 2D buffer for overlay
let overlayVisible = true;
let savedScaffolding = false; // ensures the scaffolding image is saved only once
let toggleBtn;

let data;
let selectedYear = 1940;
let displayYear = '';              // year shown on screen; lags selectedYear slightly (blank until first year's delay elapses)
let pendingYear = null;            // year waiting to be displayed once the delay elapses
let yearDisplayTimer = 0;          // frames remaining before displayYear catches up
const YEAR_DISPLAY_DELAY = 250;     // frames to wait before updating the year display
let sizes = [];
let avgElev = [];

const ELEV_BASELINE = 100; // elevations never go below 100
let globalScaleMin = 0;    // sqrt(size - baseline) extremes across ALL years,
let globalScaleMax = 1;    // so ring size/intensity are comparable year-to-year

let years = [];       // sorted chronologically — used for x position
let playOrder = [];   // shuffled copy — order years are animated in
let yearIndex = 0;    // index into playOrder
const PAUSE_BETWEEN_YEARS = 7; // frames to wait after a year finishes
let pauseTimer = 0;

let raindrops = [];
let rings = [];
let traces = []; // persistent dots left behind by fired rings

let dropSound;
let bgSound;

function preload(){
    waveShader = loadShader('ripple.vert', 'ripple.frag');
    smoothShader = loadShader('ripple.vert', 'smooth.frag');
    data = loadTable('field-measurements.csv', 'csv', 'header');
    //dropSound = loadSound('drop.mp3');
    dropSound = loadSound('water.mp3');
    bgSound = loadSound('background.mp3');
}

// Start the looping background track. Browsers suspend audio until a user
// gesture, so this is called from mousePressed() rather than setup(). Guarded
// so repeated clicks don't stack multiple overlapping loops.
function startBackground() {
    if (!bgSound || !bgSound.isLoaded() || bgSound.isPlaying()) return;
    bgSound.setLoop(true);
    bgSound.play();
}

// Trigger the drop sound through the raw Web Audio API instead of p5.sound's
// SoundFile.play(). play() builds a fresh AudioWorkletNode + buffer sources on
// every call, which overloads the audio thread when drops fire in rapid bursts
// and eventually drops out to silence. A bare AudioBufferSourceNode -> GainNode
// is cheap and handles thousands of overlapping one-shots without glitching.
function playDrop(amp) {
    if (!dropSound || !dropSound.isLoaded() || !dropSound.buffer) return;
    let ac = getAudioContext();
    if (ac.state !== 'running') return; // audio is suspended until a user gesture
    // Wrapped so a single bad play() can never throw out of draw() and freeze
    // the whole animation loop. If it ever fails, the reason is logged once.
    try {
        let vol = constrain(amp, 0, 0.8); // AudioParams reject non-finite/out-of-range
        let src = ac.createBufferSource();
        src.buffer = dropSound.buffer; // reuse the buffer p5 already decoded
        let gain = ac.createGain();
        gain.gain.value = vol;
        // Connect in separate statements: AudioNode.connect() returns undefined
        // in some browsers, so chaining .connect().connect() throws.
        src.connect(gain);
        gain.connect(ac.destination);
        // Release the nodes once the one-shot finishes. Without this the gain node
        // stays wired to the output forever; thousands pile up over the infinite
        // loop and the audio graph eventually stalls the page.
        src.onended = () => {
            src.disconnect();
            gain.disconnect();
        };
        src.start();
    } catch (e) {
        console.warn('playDrop failed:', e);
    }
}

function sizesForYear(year) {
    let out = [];
    for (let row of data.rows) {
        if (int(row.get('year')) === year) {
            let v = parseFloat(row.get('value'));
            if (!isNaN(v)) out.push(v);
        }
    }
    return out;
}

function uniqueYears() {
    let years = new Set();
    for (let row of data.rows) {
        let y = int(row.get('year'));
        if (y) years.add(y);
    }
    return Array.from(years).sort((a, b) => a - b);
}

function shuffled(arr) {
    let out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        let j = floor(random(i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function setup(){
    pixelDensity(2);
    createCanvas(windowWidth, windowHeight, WEBGL);

    frameRate(60);

    cols = floor(width / SIM_SCALE);
    rows = floor(height / SIM_SCALE);

    //initialize 2d cols by rows arrays with 0s
    current = new Array(cols).fill(0).map(() => new Array(rows).fill(0));
    previous = new Array(cols).fill(0).map(() => new Array(rows).fill(0));

    //apply default damping value to each cell in the field
    //dampingField = new Array(cols).fill(0).map(() => new Array(rows).fill(defaultDamping));

    dataImg = createImage(cols, rows);

    sceneBuf = createGraphics(width, height, WEBGL);
    sceneBuf.noStroke();

    loadOverlay();

    years = uniqueYears();
    playOrder = shuffled(years);
    yearIndex = 0;
    selectedYear = playOrder[yearIndex];
    // Queue the first year through the same delayed path as later years, so the
    // label reflects whichever year actually plays first instead of a hardcoded value.
    pendingYear = selectedYear;
    yearDisplayTimer = YEAR_DISPLAY_DELAY;
    sizes = sizesForYear(selectedYear);

    avgElev = years.map(y => {
        let s = sizesForYear(y);
        return { year: y, avg: s.reduce((a, b) => a + b, 0) / s.length };
    });
    for (let e of avgElev) print(`Average elevation for ${e.year}: ${e.avg.toFixed(2)}`);

    // Global scale extremes across every measurement in every year. Ring radius
    // and intensity are normalized against these so a given elevation looks the
    // same size regardless of which year it appears in.
    let allScales = years
        .flatMap(y => sizesForYear(y))
        .map(s => sqrt(max(0, s - ELEV_BASELINE)));
    globalScaleMin = Math.min(...allScales);
    globalScaleMax = Math.max(...allScales);

    spawnRaindrops();
}

function loadOverlay(){
    overlay = createGraphics(width, height);
        overlay.textAlign(CENTER, CENTER);
        overlay.textSize(16);

        // Mount the overlay buffer as a visible HTML element on top of the WEBGL canvas
        overlay.position(0, 0);
        overlay.show();
        overlay.canvas.style.pointerEvents = 'none';
        overlay.canvas.style.zIndex = '10';

        // toggleBtn = createButton('Hide scaffolding');
        // toggleBtn.position(10, 10);
        // toggleBtn.style('z-index', '20');
        // toggleBtn.mousePressed(() => {
        //     overlayVisible = !overlayVisible;
        //     if (overlayVisible) {
        //         overlay.show();
        //         toggleBtn.html('Hide scaffolding');
        //     } else {
        //         overlay.hide();
        //         toggleBtn.html('Show scaffolding');
        //     }
        // });
}

function resetDampingFields() {
    for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
            dampingField[x][y] = defaultDamping;
        }
    }
}

class Raindrop {
    constructor({ x, y, radius, intensity, delay, size, damping }) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.intensity = intensity;
        this.delay = delay;
        this.size = size;
        this.damping = damping;
        this.timer = 0;
    }

    isReady() {
        this.timer++;
        return this.timer >= this.delay;
    }
}

function spawnRaindrops() {
    //DampingFields();

    // Treat each (size - baseline) as an area; radius is proportional to sqrt(area).
    // Normalize against the global extremes (across all years) so ring size is
    // comparable year-to-year, not rescaled within each year.
    let scales = sizes.map(s => sqrt(max(0, s - ELEV_BASELINE)));
    let scaleMin = globalScaleMin;
    let scaleMax = globalScaleMax;

    // x is by chronological position so each year always lands in the same spot,
    // even though years play in random order.
    let chronoIndex = years.indexOf(selectedYear);
    let rx = floor(map(chronoIndex, 0, max(1, years.length - 1), cols * 0.1, cols * 0.9));
    //let ry = floor(cols / 2); 
    //let ry = floor(rows / 2);

    let avgs = avgElev.map(e => e.avg);
    let minAvg = Math.min(...avgs);
    let maxAvg = Math.max(...avgs);
    let yearAvg = avgElev.find(e => e.year === selectedYear).avg;
    // Higher elevation -> higher on screen (smaller y)
    let ry = floor(map(yearAvg, minAvg, maxAvg, rows * 0.8, rows * 0.2));

    let maxRadius = min(cols, rows) * 0.2; //set to 40% of viewport (in sim cells)

    for (let i = 0; i < sizes.length; i++) {
        let radius = (scales[i] / scaleMax) * maxRadius;
        //controls speed
        let delay = floor(map(i, 0, sizes.length - 1, 250, 600)); //animate the appearance of the rings

        let intense = map(scales[i], scaleMin, scaleMax, intensity * 0.3, intensity);
        //let dropDamping = map(scales[i], scaleMin, scaleMax, 0.985, 0.91);

        let dropDamping = defaultDamping; 

        raindrops.push(new Raindrop({
            x: rx,
            y: ry,
            radius: radius,
            intensity: intense,
            delay: delay,
            size: sizes[i],
            damping: dropDamping
        }));
    }
}

function pickHoveredRing() {
    // Closest ring whose circumference is within tolerance of the cursor.
    const tolerance = 8;
    let best = -1;
    let bestDelta = tolerance;
    for (let i = 0; i < rings.length; i++) {
        let r = rings[i];
        let delta = abs(dist(mouseX, mouseY, r.x, r.y) - r.radius);
        if (delta < bestDelta) {
            bestDelta = delta;
            best = i;
        }
    }
    return best;
}

function pickHoveredTrace() {
    const tolerance = 8;
    let best = -1;
    let bestDist = tolerance;
    for (let i = 0; i < traces.length; i++) {
        let t = traces[i];
        let d = dist(mouseX, mouseY, t.x, t.y);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

function redrawOverlay() {
    overlay.clear();
    let hovered = pickHoveredRing();
    let hoveredTrace = pickHoveredTrace();

    //update current year display at top of screen 
    overlay.noStroke();
    overlay.fill(255);
    overlay.textSize(18);
    overlay.text(`${displayYear}`, width / 2, 30);

    // Persistent center traces left behind by fired raindrops
    // overlay.noStroke();
    // for (let i = 0; i < traces.length; i++) {
    //     let t = traces[i];
    //     if (i === hoveredTrace) {
    //         overlay.fill(255);
    //         overlay.ellipse(t.x, t.y, 6, 6);
    //     } else {
    //         overlay.fill(255, 180);
    //         overlay.ellipse(t.x, t.y, 3, 3);
    //     }
    // }

    overlay.noFill();
    overlay.strokeWeight(1);
    for (let i = 0; i < rings.length; i++) {
        let r = rings[i];
        overlay.stroke(255, i === hovered ? 255 : 120);
        overlay.ellipse(r.x, r.y, r.radius * 2, r.radius * 2);
    }

    if (hovered >= 0) {
        let r = rings[hovered];
        overlay.noStroke();
        overlay.fill(255);
        overlay.text(r.size.toFixed(2), r.x, r.y - r.radius - 10);
    }

    if (hoveredTrace >= 0) {
        let t = traces[hoveredTrace];
        overlay.noStroke();
        overlay.fill(255);
        overlay.text(`${t.year}  avg ${t.avg.toFixed(2)} ft`, t.x, t.y - 12);
    }
}

function stampRing(cx, cy, radius, value, ringDamping) {
    let steps = max(16, floor(TWO_PI * radius));
    for (let s = 0; s < steps; s++) {
        let angle = (s / steps) * TWO_PI;
        let px = floor(cx + cos(angle) * radius);
        let py = floor(cy + sin(angle) * radius);
        if (px > 0 && px < cols - 1 && py > 0 && py < rows - 1) {
            previous[px][py] += value;
            //dampingField[px][py] = min(dampingField[px][py], ringDamping);
        }
    }
}

function mousePressed(){
    userStartAudio(); // required to unlock Web Audio on some browsers
    startBackground();
    overlay.clear();
    rings = [];
    //spawnRaindrops();
}

function draw(){
    // Each raindrop fires exactly once after its delay
    for (let i = raindrops.length - 1; i >= 0; i--) {
        let r = raindrops[i];
        if (r.isReady()) {
            stampRing(r.x, r.y, r.radius, r.intensity, r.damping);
            let cx = r.x * SIM_SCALE;
            let cy = r.y * SIM_SCALE;
            rings.push({
                x: cx,
                y: cy,
                radius: r.radius * SIM_SCALE,
                size: r.size
            });
            let entry = avgElev.find(e => e.year === selectedYear);
            traces.push({ x: cx, y: cy, year: selectedYear, avg: entry ? entry.avg : NaN });
            playDrop(r.intensity / (intensity * 0.8));
            raindrops.splice(i, 1);
        }
    }

    // Advance to next year (in shuffled order) once the current year's drops have all fired.
    // Loops infinitely — re-shuffles play order at the end of each pass.
    if (raindrops.length === 0) {
        pauseTimer++;
        if (pauseTimer >= PAUSE_BETWEEN_YEARS) {
            pauseTimer = 0;
            yearIndex++;
            if (yearIndex >= playOrder.length) {
                // Full pass complete — every year has been drawn.
                // Save an image of the accumulated scaffolding once, before it's reset.
                if (!savedScaffolding) {
                    //redrawOverlay();
                    overlay.save('scaffolding.png');
                    savedScaffolding = true;
                }
                yearIndex = 0;
                traces = [];
                playOrder = shuffled(years);
            }
            selectedYear = playOrder[yearIndex];
            // Defer the on-screen year update so the label changes a moment
            // after the new year's drops actually start.
            pendingYear = selectedYear;
            yearDisplayTimer = YEAR_DISPLAY_DELAY;
            sizes = sizesForYear(selectedYear);
            overlay.clear();
            rings = [];
            spawnRaindrops();
        }
    }

    // Let the displayed year catch up to selectedYear after the delay elapses.
    if (pendingYear !== null) {
        yearDisplayTimer--;
        if (yearDisplayTimer <= 0) {
            displayYear = pendingYear;
            pendingYear = null;
        }
    }

    redrawOverlay();

    dataImg.loadPixels();

    for(let x = 1; x < cols - 1; x++){
        for(let y = 1; y < rows - 1; y++){
            current[x][y] = (
                previous[x - 1][y] +
                previous[x + 1][y] +
                previous[x][y - 1] +
                previous[x][y + 1]) /
                2 -
                current[x][y];
            //current[x][y] *= dampingField[x][y];
            current[x][y] = current[x][y] * defaultDamping;

            //pack height into the data texture (red channel is sampled in the shader)
            let index = (x + y * cols) * 4;
            let colorValue = current[x][y] * 255;
            dataImg.pixels[index] = colorValue;
            dataImg.pixels[index + 1] = colorValue;
            dataImg.pixels[index + 2] = colorValue;
            dataImg.pixels[index + 3] = 255;
        }

    }
    dataImg.updatePixels();

    sceneBuf.shader(waveShader);
    waveShader.setUniform('uTex', dataImg);
    sceneBuf.rect(0, 0, width, height);

    shader(smoothShader);
    smoothShader.setUniform('uTex', sceneBuf);
    smoothShader.setUniform('uTexSize', [width, height]);
    noStroke();
    rect(0, 0, width, height);

    //swap the buffers
    let temp = previous;
    previous = current;
    current = temp;
}
