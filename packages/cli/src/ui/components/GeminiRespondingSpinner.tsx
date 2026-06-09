import React from 'react';
import { Text } from 'ink';
import { useStreamingContext } from '../contexts/StreamingContext.js';
import { StreamingState } from '../types.js';
import { useAnimation } from '../hooks/useAnimation.js';

const BRAILLE_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const BRAILLE_DOTS = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
const BRAILLE_BOUNCE = ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'];
const BRAILLE_BLOCK = ['▖', '▘', '▝', '▗'];

export type BrailleSpinnerStyle = 'braille' | 'dots' | 'bounce' | 'block';

const SPINNER_SETS: Record<BrailleSpinnerStyle, string[]> = {
  braille: BRAILLE_SPINNER,
  dots: BRAILLE_DOTS,
  bounce: BRAILLE_BOUNCE,
  block: BRAILLE_BLOCK,
};

interface BrailleSpinnerProps {
  nonRespondingDisplay?: string;
  spinnerStyle?: BrailleSpinnerStyle;
}

export const GeminiRespondingSpinner: React.FC<BrailleSpinnerProps> = ({
  nonRespondingDisplay,
  spinnerStyle = 'braille',
}) => {
  const streamingState = useStreamingContext();
  const { frame } = useAnimation(80, streamingState === StreamingState.Responding);

  if (streamingState === StreamingState.Responding) {
    const chars = SPINNER_SETS[spinnerStyle] || BRAILLE_SPINNER;
    return <Text>{chars[frame % chars.length]}</Text>;
  } else if (nonRespondingDisplay) {
    return <Text>{nonRespondingDisplay}</Text>;
  }
  return null;
};