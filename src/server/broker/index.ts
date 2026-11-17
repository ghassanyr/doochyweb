import { ctraderBrokerAdapter } from "./ctrader";
import { mt5BrokerAdapter } from "./mt5";
import type { BrokerAdapter, BrokerId } from "./types";

const adapters: Partial<Record<BrokerId, BrokerAdapter>> = {
  ctrader: ctraderBrokerAdapter,
  mt5: mt5BrokerAdapter,
};

export function isBrokerId(value: unknown): value is BrokerId {
  return value === "ctrader" || value === "mt5";
}

export function getBrokerAdapter(id: BrokerId): BrokerAdapter {
  const adapter = adapters[id];
  if (!adapter) throw new Error(`No broker adapter registered for ${id}`);
  return adapter;
}

export function registeredBrokerIds(): BrokerId[] {
  return Object.keys(adapters) as BrokerId[];
}

export { ctraderAccountRef, ctraderBrokerAdapter } from "./ctrader";
export { createMt5BrokerAdapter, mt5AccountRef, mt5BrokerAdapter } from "./mt5";
export * from "./types";
