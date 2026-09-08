// Installs the shared C13b adapters, then mutates only bash-invalid-semantics-rules.
import { installBashCompoundSafetySabotage } from "./bash-compound-safety.js";
installBashCompoundSafetySabotage("checkBashInvalidSemanticsRules");
