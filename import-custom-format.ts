#!/usr/bin/env node
import Sqlite from "better-sqlite3"
import { readFileSync } from "fs"
import { hostname } from "os"
import { join } from "path"

const homeDir = process.env.HOME
if (!homeDir) throw Error("no home dir")

const hostName = process.env.host || hostname()

// don't know these
const sessionNum = "-1"
const returnValue = "-1"
const DEFAULT_DURATION = "0"

const databaseFile =
	process.env.database || join(homeDir, ".histdb/zsh-history.db")

const historyFile =
	process.env.history_file ||
	process.env.HISTFILE ||
	join(homeDir, ".zsh_history")

type Entry = {
	started: string
	duration: string
	command: string
	dir: string
}

interface FullEntry extends Entry {
	session: string
	returnValue: string
	host: string
}

async function* readEntries() {
	const history = readFileSync(historyFile, { encoding: "utf8" }).split('\n')
	
	let line = 0
	for await (const entry of history) {
		line++
		
		if (entry.trim() === "") {
			continue
		}

		// Parse format: timestamp: /path/to/directory: command
		const customFormatRegex = /^(?<timestamp>\d+):\s*(?<directory>[^:]+):\s*(?<command>.*)$/
		const result = customFormatRegex.exec(entry)
		
		if (result == null) {
			console.warn(`Skipping malformed line ${line}: "${entry}"`)
			continue
		}

		if (result.groups) {
			const { timestamp, directory, command } = result.groups
			yield {
				started: timestamp,
				duration: DEFAULT_DURATION,
				command: command.trim(),
				dir: directory.trim()
			} as Entry
		}
	}
}

async function readHistory() {
	console.log(`importing history from "${historyFile}" into "${databaseFile}"`)
	const db = new Sqlite(databaseFile)
	db.exec("pragma foreign_keys = off")
	
	// Insert places for each unique directory
	const placeInsert = db.prepare("insert or ignore into places (host,dir) values (?,?)")
	
	const commandInsert = db.prepare(
		"insert or ignore into commands (argv) values (@command)",
	)
	const historyInsert = db.prepare(`INSERT INTO history
        (session, command_id, place_id, exit_status, start_time, duration)
        SELECT @session, commands.rowid, places.rowid, @returnValue, @started, @duration
        FROM commands, places
        WHERE commands.argv = @command AND places.host = @host AND places.dir = @dir`)

	console.time("took")
	db.exec("BEGIN")
	let count = 0
	
	for await (const entry of readEntries()) {
		const fullEntry: FullEntry = {
			...entry,
			session: sessionNum,
			returnValue,
			host: hostName,
		}
		
		// Insert the place (directory) first
		placeInsert.run(hostName, entry.dir)
		
		commandInsert.run(fullEntry)
		historyInsert.run(fullEntry)
		count++
	}
	
	db.exec("COMMIT")
	console.timeEnd("took")
	console.log(`inserted ${count} history entries`)
}

readHistory()