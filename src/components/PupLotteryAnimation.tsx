import { useEffect, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { createPupLotteryScene } from "./pupLotteryScene";
import "./PupLotteryAnimation.css";

export const pupLotteryDuration = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 900 : 9000;

const chapters = [
  ["公布結果", "現在公布抽籤結果！", "小布：大家的場次和報告順序都在這裡！"],
  ["抽籤小烏龍", "咦？！怎麼是我在睡覺！", "小布：按錯了！這是我的睡覺畫面！"],
  ["害羞一拍", "這張不是抽籤結果啦……", "小布：可以當作沒看到嗎？"],
  ["慌張遮照片", "等一下！先別看啦！", "小布：我擋！我馬上換回來！"],
  ["切回抽籤結果", "找到了！這張才對！", "小布：這次真的是抽籤結果。"],
  ["結果揭曉", "這才是抽籤結果！", "全部組別的場次與報告順序，一次揭曉。"],
  ["準備公布", "正在確認抽籤結果…", "小布：請稍候，馬上公布大家的場次與順位！"],
];

export function PupLotteryAnimation({ duration }: { duration: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState(0);
  const [eggFound, setEggFound] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = createPupLotteryScene(canvas);
    const reduced = duration < 1000;
    const started = performance.now();
    let frame = 0;
    let time = 0;
    let lastPhase = -1;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      time = reduced ? 0 : progress * 8.6;
      const next =
        progress === 1
          ? 6
          : reduced
            ? 0
            : time < 1.8
              ? 0
              : time < 3.2
                ? 1
                : time < 4.1
                  ? 2
                  : time < 5.55
                    ? 3
                    : time < 6.35
                      ? 4
                      : 5;
      if (next !== lastPhase) {
        lastPhase = next;
        setPhase(next);
      }
      draw(time);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    draw(0);
    frame = requestAnimationFrame(tick);
    const observer = new ResizeObserver(() => draw(time));
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [duration]);

  const [chapter, dialogue, subtitle] = chapters[phase];
  return (
    <section className="pup-lottery-story" aria-label="小布主持抽籤動畫">
      <div className="pup-lottery-caption">
        <span className="pup-lottery-chapter">{chapter}</span>
        <h2>{dialogue}</h2>
        <p>{subtitle}</p>
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="小狗小布誤播睡覺畫面，害羞地遮住照片，再切回抽籤結果。"
      />
      <div className="pup-lottery-footer">
        <span className={eggFound ? "pup-lottery-egg-found" : ""}>
          {eggFound ? "隱藏備忘：NUTC · 遠大密微 ✨" : "今天的抽籤主持：小布"}
        </span>
        <div className="pup-lottery-corner">
          <button
            type="button"
            aria-label="翻開角落的小書"
            aria-expanded={eggFound}
            onClick={() => setEggFound(!eggFound)}
          >
            <BookOpen size={18} />
          </button>
          <span>{phase === 6 ? "等待公布" : `${phase + 1} / 6`}</span>
        </div>
      </div>
    </section>
  );
}
