precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTex;
uniform vec2 uTexSize;

const float EDGE_THRESHOLD_MIN = 0.0156;
const float EDGE_THRESHOLD_REL = 0.063;
const float BLUR_RADIUS = 2.0;
const float BLUR_STRENGTH = 1.0;

float lum(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

vec3 fastBlur(vec2 uv, vec2 px) {
    vec2 o  = BLUR_RADIUS * px;
    vec2 o2 = 2.0 * BLUR_RADIUS * px;
    vec3 s = texture2D(uTex, uv + vec2(-o.x,  0.0 )).rgb
           + texture2D(uTex, uv + vec2( o.x,  0.0 )).rgb
           + texture2D(uTex, uv + vec2( 0.0, -o.y)).rgb
           + texture2D(uTex, uv + vec2( 0.0,  o.y)).rgb
           + texture2D(uTex, uv + vec2(-o2.x, -o2.y)).rgb
           + texture2D(uTex, uv + vec2( o2.x, -o2.y)).rgb
           + texture2D(uTex, uv + vec2(-o2.x,  o2.y)).rgb
           + texture2D(uTex, uv + vec2( o2.x,  o2.y)).rgb;
    return s * 0.125;
}

void main() {
    vec2 uv = vTexCoord;
    vec2 px = 1.0 / uTexSize;

    vec3 cM = texture2D(uTex, uv).rgb;
    vec3 cN = texture2D(uTex, uv + vec2(0.0, -px.y)).rgb;
    vec3 cS = texture2D(uTex, uv + vec2(0.0,  px.y)).rgb;
    vec3 cE = texture2D(uTex, uv + vec2( px.x, 0.0)).rgb;
    vec3 cW = texture2D(uTex, uv + vec2(-px.x, 0.0)).rgb;

    float lM = lum(cM);
    float lN = lum(cN);
    float lS = lum(cS);
    float lE = lum(cE);
    float lW = lum(cW);

    float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
    float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
    float range = lMax - lMin;

    vec3 aaColor = cM;
    if (range >= max(EDGE_THRESHOLD_MIN, lMax * EDGE_THRESHOLD_REL)) {
        // Second-derivative magnitude picks the dominant edge orientation.
        float horiz = abs(lN + lS - 2.0 * lM);
        float vert  = abs(lE + lW - 2.0 * lM);
        bool isHoriz = horiz >= vert;

        // Walk perpendicular to the edge, biased toward the brighter side.
        vec2 stepAxis = isHoriz ? vec2(0.0, px.y) : vec2(px.x, 0.0);
        float lPos = isHoriz ? lS : lE;
        float lNeg = isHoriz ? lN : lW;
        vec2 stepDir = lPos > lNeg ? stepAxis : -stepAxis;

        vec3 t0 = texture2D(uTex, uv + 0.5 * stepDir).rgb;
        vec3 t1 = texture2D(uTex, uv - 0.5 * stepDir).rgb;
        vec3 blended = (cM + cN + cS + cE + cW + t0 + t1) / 7.0;

        float blendAmt = clamp(1.9 * range / max(lMax, 1e-4), 0.0, 1.0);
        aaColor = mix(cM, blended, blendAmt);
    }

    vec3 blur = fastBlur(uv, px);
    gl_FragColor = vec4(mix(aaColor, blur, BLUR_STRENGTH), 1.0);
}
