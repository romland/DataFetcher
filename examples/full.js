import DataFetcher from "../index.js";
import fs from 'fs';

const DRY_RUN = true;

const config = DataFetcher.getDefaultConfiguration();

/**
 * Describe format of the seed data.
 */
config.seedDataFormat = {
	format : "CSV",
	lineTerminator : "\r\n",
	separator : ","
};

/**
 *	Describe the data in the seed file.
 * 
 *	Define which columns are needed for fetching remote data. These columns must together be a unique key
 *	They are used to verify if a record as already fetched (handy in case you need to restart midway).
 *
 * 	Example of a seed file:
 *		Column row (line 1):	zipcode,number,addition,room,street,city,otherdata,otherdata2,otherdata3,otherdata4
 *		Data row (line 2):		1234AB,1,,,TheStreet,TheTown,,,,,#N/A
 */
 config.relevantSeedDataColumns = {
	zipcode : 0,				// in CSV: zipcode
	number : 1,					// in CSV: number
	housenumberext : 2			// in CSV: addition
}

/**
 * Describe the remote service.
 * 
 * Which fields should be used from the seed-data to pass on to remote service.
 * 
 * This function is called before every request.
 * 
 *	NOTE:
 *	1. The keys are the field names you want to pass to remote service
 *	2. The values must match name of keys in relevantSeedDataColumns
 */
config.getBodyToPassToRemoteServer = (seedRow) => {
	return new URLSearchParams(
		{
			"zip" : "" + seedRow.zipcode,
			"num" : "" + seedRow.number,
			"ext" : "" + seedRow.housenumberext
		}
	);
}

/**
 * If necessary, describe how to determine whether we need to back off from the 
 * remote service for N minutes.
 */
config.queryRateLimit = (response, seedRow) => {
	return response["error"] === "Slow down."
}

/**
 *	This is the opportunity to do some post-processing on fetched data,
 *	e.g. create a new CSV file with added data.
 *
 *  NOTE: The flag must be true or responses will not be cached.
 */
config.postRunRefineEnabled = true;
config.postRunRefine = (responses, seedDataColumnNames) => {
	const refinedFilename = "./examples/data/output/refined.csv";

	console.debug("postRunRefine called with:", responses.length, "records");

	// The refined file is always machine generated so should contain no additional
	// data. It's safe to delete.
	if(fs.existsSync(refinedFilename)) {
		fs.unlinkSync(refinedFilename);
		console.debug(`Deleted ${refinedFilename}`);
	}

	// Undo randomized order.
	responses.sort((a, b) => {
		return a._seedrow.id - b._seedrow.id;
	});

	// Add which fields we would like to append to the column names.
	// Note that these column names should match the data that is appended
	// on each line in the loop below.
	seedDataColumnNames += ",seedindex,fetching,origin";
	seedDataColumnNames += config.seedDataFormat.lineTerminator;

	// Write the column names to file (always first line in a CSV file).
	fs.appendFileSync(refinedFilename, seedDataColumnNames);

	let csvLine;

	const appendField = (val) => {
		csvLine += config.seedDataFormat.separator + val;
	};
	
	// Re-assemble the seed CSV file with fetched data appended to each record.
	for(let i = 0; i < responses.length; i++) {
		// Start with the original CSV row.
		csvLine = responses[i]._seedrow.org;

		// Add our fetched fields.
		if(responses[i]._fetchEnabled === false) {
			// This is in case we are running dry mode and not actually fetching any data.
			// You do not have to care about this case in the real world.
			appendField(responses[i]._seedrow.id);
			appendField("false");
			appendField("n/a");
		} else {
			// The 'origin' field here comes from 'httpbin.org' (the default remote service).
			appendField(responses[i]._seedrow.id);
			appendField("true");
			appendField(responses[i].origin);
		}
		
		csvLine += config.seedDataFormat.lineTerminator;
		fs.appendFileSync(refinedFilename, csvLine);
	}

	console.log("Created", refinedFilename);
};


if(DRY_RUN) {
	config.runType = "DRY";
	config.seedFilename = './examples/data/test.csv';
	config.destFilename = './examples/data/output/dryrun-seed-responses.json';
	config.remoteServiceUrl = 'https://httpbin.org/post';
	config.fetchEnabled = true;
} else {
	config.runType = "REAL";
	config.seedFilename = './realseeddata.csv';
	config.destFilename = './seed-responses.json';
	config.remoteServiceUrl = 'https://some.remoteservice.nl/form.php';
	config.fetchEnabled = true;
}

/**
 * We want to use a proxy server. This is passed as-is to Axios.
 */
 config.remoteProxy = {
	host: 'proxy.scrapingbee.com',
	port: 8886,
	auth: {
		username: 'SECRET', 
		password: 'render_js=false&forward_headers_pure=true'
	}
};


console.log("Config:", config);
const df = new DataFetcher(config);
df.run();
