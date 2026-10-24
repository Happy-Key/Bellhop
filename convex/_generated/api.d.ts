/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as caseReasoning from "../caseReasoning.js";
import type * as cases from "../cases.js";
import type * as chat from "../chat.js";
import type * as crs from "../crs.js";
import type * as crsData from "../crsData.js";
import type * as http from "../http.js";
import type * as intakeTurn from "../intakeTurn.js";
import type * as model from "../model.js";
import type * as nessie from "../nessie.js";
import type * as paymentOrigins from "../paymentOrigins.js";
import type * as payout from "../payout.js";
import type * as payoutData from "../payoutData.js";
import type * as personaSetup from "../personaSetup.js";
import type * as personas from "../personas.js";
import type * as proposals from "../proposals.js";
import type * as reasoning from "../reasoning.js";
import type * as review from "../review.js";
import type * as reviewerQuestions from "../reviewerQuestions.js";
import type * as statements from "../statements.js";
import type * as system from "../system.js";
import type * as validators from "../validators.js";
import type * as voice from "../voice.js";
import type * as voiceSetup from "../voiceSetup.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  caseReasoning: typeof caseReasoning;
  cases: typeof cases;
  chat: typeof chat;
  crs: typeof crs;
  crsData: typeof crsData;
  http: typeof http;
  intakeTurn: typeof intakeTurn;
  model: typeof model;
  nessie: typeof nessie;
  paymentOrigins: typeof paymentOrigins;
  payout: typeof payout;
  payoutData: typeof payoutData;
  personaSetup: typeof personaSetup;
  personas: typeof personas;
  proposals: typeof proposals;
  reasoning: typeof reasoning;
  review: typeof review;
  reviewerQuestions: typeof reviewerQuestions;
  statements: typeof statements;
  system: typeof system;
  validators: typeof validators;
  voice: typeof voice;
  voiceSetup: typeof voiceSetup;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
