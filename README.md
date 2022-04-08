# DataFetcher
Fetch remote data based on seed data. It's thrown together quickly because I needed it. Packaged it up because I might need again.

This is mostly for when you need to be naughty, i.e. they do not want you to get that remote data. 

It handles the boring stuff:
- back-off period (in case of rate-limit/block/ban)
- delay between tasks
- user-agent randomization
- randomize order of queries
- (for now naive) csv import/export
- re-assembly of CSV files with fetched data
- error recovery (and caching in case of crash)
- proxying
- ...and more

If you are being naughty, you will want to use one of the many proxy providers to fetch from a "random" IP address.

See examples/full.js for the clues.


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
