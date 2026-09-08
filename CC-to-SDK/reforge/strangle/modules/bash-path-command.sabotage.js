// Installs the shared C13b adapters, then mutates only bash-path-command.
import { installBashCompoundSafetySabotage } from "./bash-compound-safety.js";
installBashCompoundSafetySabotage("checkPathCommand");
