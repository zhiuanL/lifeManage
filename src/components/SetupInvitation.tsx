import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLifeOS } from "../app/LifeOSContext";
import { setupStepLabels, type SetupProgress } from "../domain/system/SetupProgress";

export function SetupInvitation() {
  const { setupProgressService } = useLifeOS();
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    if (setupProgressService) void setupProgressService.get().then(value => { if (current) setProgress(value); })
      .catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [setupProgressService]);
  if (error) return <div className="setup-invitation"><span role="alert">初始化进度读取失败</span><Link to="/setup">查看初始化</Link></div>;
  if (!progress || progress.completed) return null;
  return <div className="setup-invitation"><span>生活空间初始化 · {setupStepLabels[progress.step]}</span>
    <Link to="/setup">继续初始化<ArrowRight size={16} aria-hidden="true" /></Link>
  </div>;
}
