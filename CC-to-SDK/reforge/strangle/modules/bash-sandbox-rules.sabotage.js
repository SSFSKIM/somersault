// Installs the shared C13b adapters, then mutates only bash-sandbox-rules.
import { installBashCompoundSafetySabotage } from "./bash-compound-safety.js";
installBashCompoundSafetySabotage("checkSandboxRules");
