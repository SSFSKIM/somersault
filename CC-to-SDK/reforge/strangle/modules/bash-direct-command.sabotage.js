// Installs the shared C13b adapters, then mutates only bash-direct-command.
import { installBashCompoundSafetySabotage } from "./bash-compound-safety.js";
installBashCompoundSafetySabotage("checkBashDirectCommand");
