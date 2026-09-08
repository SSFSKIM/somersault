// Installs the shared C13b adapters, then mutates only bash-sandbox-auto-allow.
import { installBashCompoundSafetySabotage } from "./bash-compound-safety.js";
installBashCompoundSafetySabotage("checkBashSandboxAutoAllow");
