# DataFetcher
## Fetch remote data based on seed data

See examples/full.js for the clues.

This is mostly for when you need to be naughty and they do not want you to get that remote data.

## Installation
```
npm install github:romland/DataFetcher
```

## Usage
```
import DataFetcher from "DataFetcher";

const config = DataFetcher.getDefaultConfiguration();

// Check examples/full.js for configuration options

const df = new DataFetcher(config);
df.run();
```
