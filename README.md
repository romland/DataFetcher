# DataFetcher
Fetch remote data based on seed data. It's thrown together rather quickly because I needed it. Packaged it up because I might need it in the future again.

See examples/full.js for the clues.

This is mostly for when you need to be naughty (i.e. they do not want you to get that remote data).

If you are being naughty, you will want to use one of the many proxy providers to fetch from a "random" IP address.

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

## Additional notes
If you are not using a Proxy, just do `config.remoteProxy = undefined;`
