// Installs the shared C13b adapters, then mutates only bash-same-directory-cd.
import { installBashCompoundSafetySabotage } from "./bash-compound-safety.js";
installBashCompoundSafetySabotage("checkSameDirectoryCd");
