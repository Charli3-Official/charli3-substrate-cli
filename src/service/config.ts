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

const CliConfigSchema = z.object({
  multisig: z.object({
    addresses: z.array(z.string()),
    threshold: z.number(),
  }),
  oracleConfig: z.object({
    consensus: PalletOracleConsensusConfigurationSchema,
    messages: PalletOracleMessagesConfigurationSchema,
  }),
});

export type CliConfig = z.infer<typeof CliConfigSchema>;

export function loadCliConfig(configPath: string): CliConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Oracle config file not found: ${configPath}`);
  }

  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(fileContents);
    const config = CliConfigSchema.parse(parsed);

    console.log('Cli config', config);
    return config;
  } catch (error) {
    throw new Error(
      `Failed to load cli config from ${configPath}: ${JSON.stringify(error, null, 2)}`,
    );
  }
}
