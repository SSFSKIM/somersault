// Installs the shared C13b adapters, then mutates only bash-output-redirections.
import { installBashCompoundSafetySabotage } from "./bash-compound-safety.js";
installBashCompoundSafetySabotage("checkOutputRedirections");
