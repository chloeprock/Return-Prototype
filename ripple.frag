precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uTex;

void main() {
    float v = texture2D(uTex, vTexCoord).r;
    //background color
    vec3 deep = vec3(0.0, 0.05, 0.1);
    //ripple highlight color
    vec3 crest = vec3(0.7, 0.65, 0.9);
    const float DEEP_ALPHA = 1.0; 
    const float CREST_ALPHA = 0.1; //lower val == brighter crest
    float alpha = mix(DEEP_ALPHA, CREST_ALPHA, v);
    gl_FragColor = vec4(mix(deep, crest, v), alpha);
}
