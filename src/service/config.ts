import fs from 'fs';
import yaml from 'js-yaml';
import type { PalletOracleOracleConfiguration } from '../charli3-substrate-runtime/types.js';

export { loadCliConfig };
export type { CliConfig };

interface CliConfig {
  readonly multisig: {
    readonly addresses: string[];
    readonly threshold: number;
  };
  readonly oracleConfig: PalletOracleOracleConfiguration;
}

function loadCliConfig(configPath: string): CliConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Oracle config file not found: ${configPath}`);
  }

  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContents) as CliConfig;

    return config;
  } catch (error) {
    throw new Error(`Failed to load cli config from ${configPath}: ${error}`);
  }
}
