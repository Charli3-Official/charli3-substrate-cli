import fs from 'fs';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { Bytes } from 'dedot/codecs';

// "bytes" input: human-friendly utf-8 strings
// we validate as string and later transform into 0x hex
const BytesSchema = z
  .string()
  .min(1)
  .transform<Bytes>((val) => {
    if (val.startsWith('0x')) {
      return val as Bytes; // already hex
    }
    const hex = Buffer.from(val, 'utf8').toString('hex');
    return `0x${hex}` as Bytes;
  });

// Multisig Schema
const MultisigConfigSchema = z.object({
  multisig: z.object({
    addresses: z.array(z.string()),
    threshold: z.number(),
  }),
});

export type MultisigConfig = z.infer<typeof MultisigConfigSchema>;

// Oracle Schemas
const PalletOracleConfigNodeTradePairSchema = z.object({
  baseCurrency: BytesSchema,
  quoteCurrency: BytesSchema,
});

const PalletOracleConsensusConfigurationSchema = z.object({
  minNodesForTrustedAggregation: z.number(),
  feedAge: z.number(),
  outliersRange: z.number(),
  divergency: z.number(),
  tradePairs: z.array(PalletOracleConfigNodeTradePairSchema),
});

const PalletOracleMessagesConfigurationSchema = z.array(
  z.tuple([BytesSchema, z.array(z.number())]),
);

const PalletOracleRewardConfigurationSchema = z.object({
  rewardPolicyId: BytesSchema,
  rewardAssetName: BytesSchema,
});

const OracleConfigSchema = z.object({
  oracleConfig: z.object({
    consensus: PalletOracleConsensusConfigurationSchema,
    messages: PalletOracleMessagesConfigurationSchema,
    reward: PalletOracleRewardConfigurationSchema.optional(),
  }),
});

export type OracleConfig = z.infer<typeof OracleConfigSchema>;

// Combined Schema (if you still need it)
const CliConfigSchema = z.object({
  multisig: MultisigConfigSchema.shape.multisig,
  oracleConfig: OracleConfigSchema.shape.oracleConfig,
});

export type CliConfig = z.infer<typeof CliConfigSchema>;

// Separate Loaders
export function loadMultisigConfig(configPath: string): MultisigConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Multisig config file not found: ${configPath}`);
  }

  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(fileContents);
    const config = MultisigConfigSchema.parse(parsed);
    console.log('Multisig config', config);
    return config;
  } catch (error) {
    throw new Error(
      `Failed to load multisig config from ${configPath}: ${JSON.stringify(error, null, 2)}`,
    );
  }
}

export function loadOracleConfig(configPath: string): OracleConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Oracle config file not found: ${configPath}`);
  }

  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(fileContents);
    const config = OracleConfigSchema.parse(parsed);
    console.log('Oracle config', config);
    return config;
  } catch (error) {
    throw new Error(
      `Failed to load oracle config from ${configPath}: ${JSON.stringify(error, null, 2)}`,
    );
  }
}

// Combined loader
export function loadCliConfig(configPath: string): CliConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`CLI config file not found: ${configPath}`);
  }

  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(fileContents);
    const config = CliConfigSchema.parse(parsed);
    console.log('CLI config', config);
    return config;
  } catch (error) {
    throw new Error(
      `Failed to load CLI config from ${configPath}: ${JSON.stringify(error, null, 2)}`,
    );
  }
}
