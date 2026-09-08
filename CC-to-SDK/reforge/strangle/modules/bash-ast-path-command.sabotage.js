// Installs the shared C13b adapters, then mutates only bash-ast-path-command.
import { installBashCompoundSafetySabotage } from "./bash-compound-safety.js";
installBashCompoundSafetySabotage("checkAstPathCommand");
