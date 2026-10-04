// Canvas artwork and camera sequence adapted from the supplied 小布 animation.
export function createPupLotteryScene(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return () => {};
  const ctx: CanvasRenderingContext2D = context;
  const c = {
    white: "#fffdf8",
    blue: "#4387f2",
    navy: "#2b4775",
    line: "#c9dbf1",
    soft: "#deebff",
    faint: "#e6eef9",
    shadow: "#dce9f8",
    ink: "#254472",
  };
  const clamp = (x: number) => Math.max(0, Math.min(1, x)),
    mix = (a: number, b: number, p: number) => a + (b - a) * clamp(p),
    ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3),
    smooth = (x: number) => {
      const p = clamp(x);
      return p * p * (3 - 2 * p);
    },
    pulse = (t: number, s: number, d: number) => {
      const p = (t - s) / d;
      return p > 0 && p < 1 ? Math.sin(p * Math.PI) : 0;
    };
  function rr(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill?: string,
    stroke?: string,
  ) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  function dot(x: number, y: number, r: number, color: string) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  function ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    color: string,
    angle = 0,
  ) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  function line(points: [number, number][], color: string, width = 2) {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  function text(
    value: string,
    x: number,
    y: number,
    size = 12,
    color = c.ink,
    align: CanvasTextAlign = "center",
  ) {
    ctx.font = "500 " + size + 'px system-ui,"Microsoft JhengHei",sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  }
  function spark(x: number, y: number, r: number, color = c.blue) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + 2, y - 2, x + r, y);
    ctx.quadraticCurveTo(x + 2, y + 2, x, y + r);
    ctx.quadraticCurveTo(x - 2, y + 2, x - r, y);
    ctx.quadraticCurveTo(x - 2, y - 2, x, y - r);
    ctx.fillStyle = color;
    ctx.fill();
  }
  function remote(x: number, y: number, a = 0, press = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    rr(-7, -17, 14, 34, 5, c.navy);
    dot(0, -8, 3, c.blue);
    dot(0, 3, 2, c.line);
    if (press > 0) {
      ctx.globalAlpha = press;
      ctx.beginPath();
      ctx.arc(0, -8, 7 + (1 - press) * 12, 0, Math.PI * 2);
      ctx.strokeStyle = c.blue;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  function pup(
    x: number,
    y: number,
    scale = 1,
    pose = "ready",
    t = 0,
    arms = 0,
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    const bob = pose === "cover" ? 0 : Math.sin(t * 4) * 1.3;
    ctx.translate(0, bob);
    ellipse(-15, 27, 14, 7, c.navy);
    ellipse(16, 27, 14, 7, c.navy);
    rr(-27, -8, 54, 34, 15, c.blue);
    rr(-18, 4, 36, 15, 6, c.white);
    text("NUTC", 0, 15, 10, c.blue);
    ctx.save();
    if (pose === "shy") {
      ctx.translate(0, 5);
      ctx.rotate(-0.065);
    }
    if (pose === "panic")
      ctx.translate(Math.sin(t * 24) * pulse(t, 1.8, 0.35) * 2, 0);
    ellipse(-34, -44, 12, 27, "#d5baa0", pose === "shy" ? -0.09 : -0.27);
    ellipse(34, -44, 12, 27, "#d5baa0", pose === "shy" ? 0.09 : 0.27);
    rr(-36, -72, 72, 67, 28, c.white, c.line);
    ellipse(-20, -50, 10, 12, "#ead8c4", -0.1);
    // Rounded features keep the embarrassed close-up gentle and readable.
    const curve = (
      x1: number,
      y1: number,
      cx: number,
      cy: number,
      x2: number,
      y2: number,
      width = 2,
    ) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.strokeStyle = c.navy;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.stroke();
    };
    const embarrassed = pose === "shy";
    ctx.save();
    ctx.globalAlpha = embarrassed ? 0.65 : 0.45;
    ellipse(-25, -24, embarrassed ? 9 : 7, 5, "#f4b7c5");
    ellipse(25, -24, embarrassed ? 9 : 7, 5, "#f4b7c5");
    ctx.restore();

    if (pose === "cover") {
      // Wide eyes and raised brows make the jumping panic clear at stage scale.
      for (const eyeX of [-16, 16]) {
        ellipse(eyeX, -40, 7.5, 9, c.white);
        ctx.beginPath();
        ctx.ellipse(eyeX, -40, 7.5, 9, 0, 0, Math.PI * 2);
        ctx.strokeStyle = c.navy;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ellipse(eyeX, -42, 3.5, 4.5, c.navy);
        dot(eyeX - 1, -44, 1.2, c.white);
      }
      curve(-25, -54, -17, -62, -9, -57, 2.3);
      curve(9, -57, 17, -62, 25, -54, 2.3);
    } else if (pose === "sleep") {
      curve(-23, -39, -16, -33, -9, -39, 2.5);
      curve(9, -39, 16, -33, 23, -39, 2.5);
    } else {
      const shy = pose === "shy";
      const startled = pose === "panic";
      const eyeY = shy ? -37 : -40;
      const eyeHeight = shy ? 4.2 : startled ? 6.5 : 5.5;
      const glance = shy ? -1.5 : 0;
      for (const eyeX of [-16, 16]) {
        ellipse(eyeX + glance, eyeY, 4.5, eyeHeight, c.navy);
        dot(eyeX + glance - 1.2, eyeY - 1.8, 1.4, c.white);
      }
      if (shy) {
        curve(-23, -49, -17, -52, -10, -49, 1.6);
        curve(10, -49, 17, -52, 23, -49, 1.6);
      } else if (startled) {
        curve(-24, -52, -17, -57, -10, -54, 1.8);
        curve(10, -54, 17, -57, 24, -52, 1.8);
      }
    }
    ellipse(0, -27, 4, 3, c.navy);
    if (pose === "cover") {
      ellipse(0, -15, 6, 7, c.navy);
    } else if (pose === "panic") {
      ellipse(0, -16, 3.5, 4.5, c.navy);
    } else if (pose === "sleep") {
      curve(-3, -17, 0, -15, 3, -17, 1.5);
    } else {
      curve(0, -24, 0, -21, 0, -20, 1.6);
      const smileWidth = pose === "shy" ? 5 : 8;
      curve(-smileWidth, -19, 0, -12, smileWidth, -19, 1.8);
    }
    ctx.restore();
    if (pose === "sleep") {
      line(
        [
          [-25, 0],
          [-31, 7],
        ],
        c.blue,
        8,
      );
      line(
        [
          [25, 0],
          [31, 7],
        ],
        c.blue,
        8,
      );
      dot(-31, 7, 7, c.white);
      dot(31, 7, 7, c.white);
    } else if (pose === "cover") {
      line(
        [
          [-25, 0],
          [-40, -27],
          [-48, -45],
        ],
        c.blue,
        9,
      );
      line(
        [
          [25, 0],
          [40, -27],
          [48, -45],
        ],
        c.blue,
        9,
      );
      dot(-48, -45, 7, c.white);
      dot(48, -45, 7, c.white);
    } else {
      line(
        [
          [-25, 0],
          [-38, 5],
          [-43, -3],
        ],
        c.blue,
        8,
      );
      dot(-43, -3, 6, c.white);
      ctx.save();
      ctx.translate(25, -1);
      ctx.rotate(arms);
      line(
        [
          [0, 0],
          [20, -9],
        ],
        c.blue,
        8,
      );
      dot(20, -9, 6, c.white);
      remote(22, -16, -0.2, pulse(t, 1.3, 0.28) + pulse(t, 5.65, 0.32));
      ctx.restore();
    }
    if (pose === "panic" || pose === "cover") {
      ctx.fillStyle = "#9bc6ff";
      ctx.beginPath();
      ctx.moveTo(40, -57);
      ctx.quadraticCurveTo(48, -43, 40, -43);
      ctx.quadraticCurveTo(33, -43, 40, -57);
      ctx.fill();
    }
    ctx.restore();
  }
  function sillyPhoto() {
    rr(329, 50, 194, 110, 9, c.white);
    rr(338, 58, 175, 81, 6, c.soft);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(338, 58, 175, 81, 6);
    ctx.clip();
    spark(363, 78, 5, c.white);
    spark(490, 116, 6, c.white);
    dot(483, 74, 3, c.white);
    rr(390, 123, 72, 30, 16, c.blue);
    ellipse(392, 94, 10, 23, "#d5baa0", -0.2);
    ellipse(460, 94, 10, 23, "#d5baa0", 0.2);
    rr(391, 64, 70, 67, 28, c.white, c.line);
    ellipse(407, 86, 9, 11, "#ead8c4", -0.1);
    ellipse(402, 110, 7, 4, "#f4b7c5");
    ellipse(450, 110, 7, 4, "#f4b7c5");
    // One bright eye and one curved wink, with a small tongue-out smile.
    ellipse(412, 96, 4.5, 6, c.navy);
    dot(410.5, 94, 1.5, c.white);
    ctx.beginPath();
    ctx.moveTo(433, 97);
    ctx.quadraticCurveTo(440, 89, 447, 97);
    ctx.strokeStyle = c.navy;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.stroke();
    ellipse(426, 106, 4, 3, c.navy);
    ctx.beginPath();
    ctx.moveTo(416, 113);
    ctx.quadraticCurveTo(426, 125, 438, 112);
    ctx.quadraticCurveTo(426, 117, 416, 113);
    ctx.fillStyle = c.navy;
    ctx.fill();
    rr(426, 115, 8, 11, 4, "#f0a8bd");
    line(
      [
        [430, 116],
        [430, 121],
      ],
      "#d681a0",
      1,
    );
    ctx.restore();
    text("小布的鬼臉照片", 426, 153, 11, c.navy);
  }
  function projection(t: number) {
    rr(318, 33, 216, 133, 10, c.white, c.line);
    rr(318, 33, 216, 9, 4, c.navy);
    line(
      [
        [426, 168],
        [426, 202],
      ],
      c.line,
      4,
    );
    line(
      [
        [401, 203],
        [451, 203],
      ],
      c.line,
      4,
    );
    if (t < 1.8) {
      text("報告順序抽籤", 426, 91, 21, c.navy);
      text("現在公布結果！", 426, 119, 13, c.blue);
      text("全組別一起揭曉", 426, 152, 11, c.navy);
    } else if (t < 6.35) {
      sillyPhoto();
    } else {
      const p = ease((t - 6.35) / 0.5);
      ctx.save();
      ctx.globalAlpha = p;
      rr(329, 50, 194, 109, 8, c.white);
      text("抽籤結果", 426, 70, 16, c.ink);
      for (let s = 0; s < 2; s++) {
        const x = 345 + s * 86;
        rr(x, 80, 75, 13, 3, c.soft);
        text(s === 0 ? "第一場次" : "第二場次", x + 37.5, 89, 8, c.blue);
        for (let i = 0; i < 6; i++) {
          rr(x, 99 + i * 8, 75, 1, 0, c.line);
          rr(x + 3, 95 + i * 8, 12, 2, 1, c.line);
          rr(x + 37, 95 + i * 8, 27, 2, 1, c.soft);
        }
      }
      ctx.restore();
    }
    if (t >= 5.65 && t < 6.6) {
      const opacity = pulse(t, 5.65, 0.95) * 0.85;
      ctx.save();
      ctx.globalAlpha = opacity;
      rr(322, 44, 208, 119, 7, c.white);
      ctx.restore();
    }
  }
  function actor(t: number) {
    if (t < 1.2) {
      const p = ease(t / 1.2);
      return {
        x: mix(115, 208, p),
        y: 176 + (t ? Math.sin(t * 16) * (1 - p) * 2 : 0),
        pose: "ready",
        a: 0,
      };
    }
    if (t < 1.8)
      return { x: 208, y: 176, pose: "ready", a: -pulse(t, 1.2, 0.5) * 0.35 };
    if (t < 3.2) return { x: 208, y: 176, pose: "panic", a: 0.5 };
    if (t < 4.1) return { x: 208, y: 176, pose: "shy", a: 0.5 };
    if (t < 5.55) {
      const p = ease((t - 4.1) / 0.55),
        hop = Math.abs(Math.sin((t - 4.1) * 9)) * 12;
      return { x: mix(208, 412, p), y: 176 - hop, pose: "cover", a: 0 };
    }
    if (t < 6.35) {
      const p = smooth((t - 5.55) / 0.55);
      return {
        x: mix(412, 241, p),
        y: 176,
        pose: "panic",
        a: -pulse(t, 5.65, 0.4) * 0.5,
      };
    }
    return { x: 241, y: 176, pose: "ready", a: -0.22 };
  }
  function camera(t: number) {
    if (t === 0) return { x: 300, y: 115, z: 1, shot: "全景開場" };
    if (t < 1.2)
      return {
        x: mix(300, 294, smooth(t / 1.2)),
        y: 115,
        z: 1,
        shot: "全景開場",
      };
    if (t < 1.8) return { x: 256, y: 146, z: 2, shot: "抽籤遙控器特寫" };
    if (t < 3.2)
      return {
        x: 426,
        y: 100,
        z: mix(1.75, 1.88, ease((t - 1.8) / 1.4)),
        shot: "誤播照片特寫",
      };
    if (t < 4.1) return { x: 208, y: 137, z: 2.1, shot: "害羞表情特寫" };
    if (t < 5.55)
      return {
        x: mix(360, 411, ease((t - 4.1) / 0.7)),
        y: 125,
        z: 1.45,
        shot: "慌張遮畫面",
      };
    if (t < 6.35)
      return {
        x: mix(430, 288, smooth((t - 5.55) / 0.6)),
        y: 144,
        z: 1.9,
        shot: "重新按遙控器",
      };
    if (t < 7.35) return { x: 426, y: 101, z: 1.8, shot: "抽籤結果揭曉" };
    return {
      x: 426,
      y: mix(101, 90, smooth((t - 7.35) / 1.05)),
      z: mix(1.8, 3.4, smooth((t - 7.35) / 1.05)),
      shot: "放大進入抽籤結果",
    };
  }
  function draw(t = 0) {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(h * dpr)
    ) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = Math.min(w / 600, h / 230);
    ctx.translate((w - 600 * s) / 2, (h - 230 * s) / 2);
    ctx.scale(s, s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 600, 230);
    ctx.clip();
    const shot = camera(t);
    canvas.dataset.shot = shot.shot;
    ctx.translate(300, 115);
    ctx.scale(shot.z, shot.z);
    ctx.translate(-shot.x, -shot.y);
    ellipse(306, 206, 241, 9, c.shadow);
    line(
      [
        [49, 204],
        [556, 204],
      ],
      c.line,
    );
    for (let i = 0; i < 5; i++)
      spark(55 + i * 120, 40 + (i % 2) * 27, 4, c.faint);
    projection(t);
    rr(86, 156, 65, 45, 6, c.soft, c.line);
    rr(108, 169, 21, 4, 2, c.line);
    line(
      [
        [118, 156],
        [118, 145],
        [129, 141],
      ],
      c.navy,
      2,
    );
    dot(129, 141, 3, c.navy);
    const a = actor(t);
    pup(a.x, a.y, 1, a.pose, t, a.a);
    if (t >= 3.2 && t < 4.1) text("！", 257, 95, 24, c.blue);
    if (t >= 6.35) {
      const p = clamp((t - 6.35) / 0.65);
      ctx.globalAlpha = 1 - p;
      for (let i = 0; i < 9; i++) {
        const ang = i * 2.399,
          r = 30 + p * 95;
        spark(
          426 + Math.cos(ang) * r,
          104 + Math.sin(ang) * r * 0.55,
          4,
          c.blue,
        );
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  return draw;
}
