import compiledRuntimeBootstrap from "virtual:driver-runtime-bootstrap";
import { RUNTIME_VERSION } from "./constants";

export const RUNTIME_BOOTSTRAP =
  `${compiledRuntimeBootstrap}\n;__pwRuntimeBootstrap.default(${JSON.stringify(RUNTIME_VERSION)});`;
