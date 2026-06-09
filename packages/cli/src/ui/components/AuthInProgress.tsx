import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors, Semantic } from '../colors.js';
import { useAnimation } from '../hooks/useAnimation.js';

const AUTH_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface AuthInProgressProps {
  onTimeout: () => void;
}

export function AuthInProgress({
  onTimeout,
}: AuthInProgressProps): React.JSX.Element {
  const [timedOut, setTimedOut] = useState(false);
  const { frame } = useAnimation(80, !timedOut);

  useInput((_, key) => {
    if (key.escape) {
      onTimeout();
    }
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOut(true);
      onTimeout();
    }, 180000);
    return () => clearTimeout(timer);
  }, [onTimeout]);

  return (
    <Box
      borderStyle="round"
      borderColor={Semantic.Muted}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      {timedOut ? (
        <Text color={Semantic.Error}>
          Authentication timed out. Please try again.
        </Text>
      ) : (
        <Box>
          <Text>
            <Text color={Semantic.Primary}>{AUTH_FRAMES[frame % AUTH_FRAMES.length]}</Text> Waiting for auth... (Press ESC to cancel)
          </Text>
        </Box>
      )}
    </Box>
  );
}