import { useEffect, useState } from 'react';

export function useAnimation(interval = 80, isActive = true) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setFrame((f) => f + 1), interval);
    return () => clearInterval(timer);
  }, [interval, isActive]);

  return { frame };
}