"use client";

/**
 * Whether the workspace shows a live Convex case or the synthetic demo. Live-only actions (bank
 * record retrieval) check this, so the demo can never call the backend.
 */
import { createContext, useContext } from "react";

export type WorkspaceMode = "live" | "demo";

const ModeContext = createContext<WorkspaceMode>("live");
export const WorkspaceModeProvider = ModeContext.Provider;
export const useWorkspaceMode = () => useContext(ModeContext);
