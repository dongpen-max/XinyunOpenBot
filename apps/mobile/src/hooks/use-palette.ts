import { useColorScheme } from "react-native";
import { colors } from "@xinyun/design-tokens";

export const usePalette = () => colors[useColorScheme() === "dark" ? "dark" : "light"];
