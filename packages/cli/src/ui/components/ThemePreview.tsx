import { Box, Text } from 'ink';
import React from 'react';
import { Semantic, Colors } from '../colors.js';
import { Divider } from '../components/shared/Divider.js';

const colorSamples = [
  { label: 'Success', color: Semantic.Success },
  { label: 'Warning', color: Semantic.Warning },
  { label: 'Error', color: Semantic.Error },
  { label: 'Info', color: Semantic.Info },
  { label: 'Primary', color: Semantic.Primary },
  { label: 'Secondary', color: Semantic.Secondary },
  { label: 'Muted', color: Semantic.Muted },
];

const accentSamples = [
  { label: 'Blue', color: Colors.AccentBlue },
  { label: 'Purple', color: Colors.AccentPurple },
  { label: 'Cyan', color: Colors.AccentCyan },
  { label: 'Green', color: Colors.AccentGreen },
  { label: 'Yellow', color: Colors.AccentYellow },
  { label: 'Red', color: Colors.AccentRed },
];

export const ThemePreview: React.FC = () => (
  <Box flexDirection="column" paddingX={1} marginBottom={1}>
    <Divider label="Theme Preview" marginTop={0} marginBottom={1} />
    <Text bold color={Semantic.Primary}>Semantic Colors:</Text>
    <Box flexDirection="row" marginLeft={1} marginTop={1}>
      {colorSamples.map((sample) => (
        <Box key={sample.label} marginRight={2}>
          <Text color={sample.color} bold>
            {'█'}{' '}
          </Text>
          <Text color={sample.color}>{sample.label}</Text>
        </Box>
      ))}
    </Box>
    <Box height={1} />
    <Text bold color={Semantic.Primary}>Accent Colors:</Text>
    <Box flexDirection="row" marginLeft={1} marginTop={1}>
      {accentSamples.map((sample) => (
        <Box key={sample.label} marginRight={2}>
          <Text color={sample.color} bold>
            {'█'}{' '}
          </Text>
          <Text color={sample.color}>{sample.label}</Text>
        </Box>
      ))}
    </Box>
    <Box height={1} />
    <Text bold color={Semantic.Primary}>Syntax Highlighting Sample:</Text>
    <Box marginLeft={1} marginTop={1} flexDirection="column">
      <Text color={Colors.Comment}>// This is a comment</Text>
      <Text><Text color={Colors.AccentPurple}>function</Text> <Text color={Colors.AccentBlue}>hello</Text>() {'{'}</Text>
      <Text>  <Text color={Colors.AccentCyan}>const</Text> msg = <Text color={Colors.AccentGreen}>"Hello, World!"</Text>;</Text>
      <Text>  <Text color={Colors.AccentYellow}>return</Text> msg;</Text>
      <Text>{'}'}</Text>
    </Box>
    <Divider marginTop={1} marginBottom={0} />
  </Box>
);