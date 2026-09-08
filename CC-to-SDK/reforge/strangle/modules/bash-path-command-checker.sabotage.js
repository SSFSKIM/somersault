// Installs the shared C13b adapters, then mutates only bash-path-command-checker.
import { installBashCompoundSafetySabotage } from "./bash-compound-safety.js";
installBashCompoundSafetySabotage("createPathCommandChecker");
