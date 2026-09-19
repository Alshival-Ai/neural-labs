import { createContext } from "react";

export const TerminalLaunchContext = createContext<(terminalId: string) => Promise<void>>(async () => {
  throw new Error("Open Terminal from the desktop to continue Claude sign-in.");
});
