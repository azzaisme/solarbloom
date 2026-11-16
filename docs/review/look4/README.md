# Look 4 screenshots

`node tests/e2e/camera-shots.mjs docs/review/look4 <prefix>` on a save with the park restored (headless SwiftShader).

- `before-*`: origin/main aeeb703, desktop 1280×800 and phone 390×844, at zooms 0.22, 0.42, 0.7, 1 (default), 1.4, 1.9.
- `after-desktop-*`: the street-level park with the kerb, sky and skyline, taken before the origin/main merge and
  before the sky/skyline backdrop change (7f6c597), which changes how they are drawn but should not change how
  they look. Phone after-shots weren't taken (screenshot scripts were paused after a machine restart);
  regenerate both with the command above.
