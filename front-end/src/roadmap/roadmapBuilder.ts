import { fileIndex } from "../state/fileIndex";
import { functionIndex } from "../state/functionIndex";
import { callGraphIndex } from "../state/callGraphIndex";
import { RoadmapFile } from "./roadmapModel";

export function buildRoadmap(): RoadmapFile[] {
  return fileIndex.getAll().map((file) => {
    const fileName = file.path.split("/").pop() || file.path;
    const functions = functionIndex
      .getAll()
      .filter((fn) => fn.filePath === file.path)
      .map((fn) => ({
        name: fn.name,
        filePath: fn.filePath,
        calls: callGraphIndex
          .getAll()
          .filter((edge) => edge.callerId === fn.id)
          .map((edge) => edge.calleeName),
      }));

    return {
      path: file.path,
      name: fileName,
      functions,
    };
  });
}
