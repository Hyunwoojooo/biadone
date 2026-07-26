import { crossSourceDevDataset } from "../eval/synthetic/crossSourceDevDataset";
import { computeCrossSourceDatasetSha256 } from "../src/evaluation/crossSourceIntegrity";

console.log(
  JSON.stringify({
    datasetVersion: crossSourceDevDataset.datasetVersion,
    datasetRevision: crossSourceDevDataset.datasetRevision,
    datasetClass: crossSourceDevDataset.datasetClass,
    caseCount: crossSourceDevDataset.cases.length,
    materializedCanonicalSha256:
      computeCrossSourceDatasetSha256(crossSourceDevDataset)
  })
);
